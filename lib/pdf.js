'use strict';

// PDF rendering via Puppeteer.
//  - Local machine: uses the installed Google Chrome (falls back to a bundled
//    Chromium if present).
//  - Serverless (Vercel/Lambda): no Chrome exists there, so we ship the
//    Lambda-compatible @sparticuz/chromium build with puppeteer-core.
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const baseArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'];

      if (process.env.VERCEL || process.env.AWS_REGION || process.env.LAMBDA_TASK_ROOT) {
        // @sparticuz/chromium is ESM-only in recent versions — load it with a
        // dynamic import(), which works from CommonJS on every Node version.
        const [chromiumMod, puppeteerMod] = await Promise.all([
          import('@sparticuz/chromium'),
          import('puppeteer-core'),
        ]);
        const chromium = chromiumMod.default ?? chromiumMod;
        const puppeteer = puppeteerMod.default ?? puppeteerMod;
        chromium.setGraphicsMode = false; // PDF output needs no graphics stack
        return await puppeteer.launch({
          args: [...baseArgs, ...chromium.args],
          executablePath: await chromium.executablePath(),
          headless: true,
          defaultViewport: { width: 1280, height: 900 },
        });
      }

      const puppeteer = require('puppeteer');
      try {
        return await puppeteer.launch({ channel: 'chrome', headless: true, args: baseArgs });
      } catch (e) {
        return await puppeteer.launch({ headless: true, args: baseArgs });
      }
    })().catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

async function renderPdf(html, { cookies = [], timeoutMs = 180000 } = {}) {
  try {
    return await renderOnce(html, { cookies, timeoutMs });
  } catch (e) {
    // The shared browser may have died (e.g. killed between requests) — relaunch once.
    if (/Connection closed|Target closed|Session closed|browser has been disconnected|Not launched/i.test(e.message)) {
      browserPromise = null;
      return renderOnce(html, { cookies, timeoutMs });
    }
    throw e;
  }
}

async function renderOnce(html, { cookies = [], timeoutMs = 180000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(false);
    for (const c of cookies) {
      await page.setCookie(c).catch(() => {});
    }
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: timeoutMs });

    // Belt & braces: make sure every question/option image finished decoding.
    await page
      .evaluate(async () => {
        const imgs = Array.from(document.images || []);
        await Promise.all(
          imgs.map((img) =>
            img.complete
              ? Promise.resolve()
              : new Promise((res) => {
                  img.onload = img.onerror = res;
                })
          )
        );
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
      })
      .catch(() => {});

    // puppeteer returns a Uint8Array — coerce to Buffer so express streams it
    // as binary rather than JSON-serialising it.
    return Buffer.from(await page.pdf({
      format: 'A4',
      printBackground: true,
      scale: 0.85, // fit more questions per page
      margin: { top: '8mm', bottom: '10mm', left: '7mm', right: '7mm' },
      timeout: timeoutMs,
    }));
  } finally {
    await page.close().catch(() => {});
  }
}

// Fetch a page through real Chrome — used as a fallback when the exam site's
// Cloudflare config blocks the plain Node fetch (HTTP 403). A genuine browser
// fingerprint (TLS, HTTP/2, headers) passes the check like the user's browser.
async function fetchViaBrowser(url, { timeoutMs = 75000 } = {}) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(true); // the challenge interstitial needs JS
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
    // If Cloudflare is interstitial-ing, give it a moment to clear itself.
    await page
      .waitForFunction(() => !/just a moment|attention required|checking your browser/i.test(document.title), {
        timeout: 20000,
      })
      .catch(() => {});
    const html = await page.content();
    return { html, status: resp ? resp.status() : 0 };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { renderPdf, fetchViaBrowser };
