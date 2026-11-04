'use strict';

// PDF rendering via Puppeteer using the locally installed Chrome
// (falls back to a bundled Chromium if present).
let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = (async () => {
      const puppeteer = require('puppeteer');
      const baseArgs = ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'];
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

module.exports = { renderPdf };
