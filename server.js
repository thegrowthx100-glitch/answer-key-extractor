'use strict';

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { deriveBranchUrls } = require('./lib/urls');
const { assertAllowedUrl, fetchText, CookieJar } = require('./lib/fetcher');
const {
  parsePart,
  partViewHtml,
  combinedHtml,
  buildFilename,
  patchInfoCard,
  DEFAULT_OPTIONS,
} = require('./lib/cleaner');
const { renderPdf, fetchViaBrowser } = require('./lib/pdf');
const store = require('./lib/store');

// ---------- simple login (hard-coded local credentials) ----------
const ADMIN_USER_ID = 'admin356';
const ADMIN_PASSWORD = 'admintoweb45@j';
const AUTH_COOKIE = 'aksid';
const authTokens = new Map(); // token -> true

function getCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0 && part.slice(0, idx).trim() === name) {
      return decodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return null;
}

function requireAuth(req, res, next) {
  const tok = getCookie(req, AUTH_COOKIE);
  if (tok && authTokens.has(tok)) return next();
  res.status(401).json({ error: 'Please log in first.' });
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PART_KEYS = ['A', 'B', 'C', 'D'];
const FETCH_RETRIES = 2;

function normalizeOptions(raw) {
  const o = { ...DEFAULT_OPTIONS };
  if (raw && typeof raw === 'object') {
    if (typeof raw.removeChallengeLinks === 'boolean') o.removeChallengeLinks = raw.removeChallengeLinks;
    if (typeof raw.removeHindiSwitch === 'boolean') o.removeHindiSwitch = raw.removeHindiSwitch;
    if (typeof raw.keepHeader === 'boolean') o.keepHeader = raw.keepHeader;
    if (typeof raw.keepLegend === 'boolean') o.keepLegend = raw.keepLegend;
  }
  return o;
}

async function fetchWithRetry(url, ctx, attempts = 3) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchText(url, ctx);
    } catch (e) {
      lastErr = e;
      const status = (e && e.status) || 0;
      // 408/429/5xx and network errors are worth retrying; other 4xx are not.
      const retryable = !status || status === 408 || status === 429 || status >= 500;
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw lastErr;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

// ---------- auth routes ----------
app.get('/api/me', (req, res) => {
  res.json({ authenticated: authTokens.has(getCookie(req, AUTH_COOKIE)) });
});

app.post('/api/login', (req, res) => {
  const { userId, password } = req.body || {};
  if (userId !== ADMIN_USER_ID || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Wrong user ID or password.' });
  }
  const tok = crypto.randomBytes(24).toString('hex');
  authTokens.set(tok, true);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${tok}; HttpOnly; Path=/; Max-Age=604800`);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const tok = getCookie(req, AUTH_COOKIE);
  if (tok) authTokens.delete(tok);
  res.setHeader('Set-Cookie', `${AUTH_COOKIE}=; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.post('/api/process', requireAuth, async (req, res) => {
  let urls;
  try {
    urls = deriveBranchUrls(req.body && req.body.url);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    urls.forEach(assertAllowedUrl);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const opts = normalizeOptions(req.body && req.body.options);
  const jar = new CookieJar();
  const results = [];

  // Plain fetch first; if Cloudflare blocks it (403/503), retry through real
  // Chrome, whose genuine browser fingerprint passes like the user's browser.
  const fetchPartHtml = async (u) => {
    try {
      const { text } = await fetchText(u, { jar, referer: urls[0], timeoutMs: 75000 });
      return text;
    } catch (e) {
      const status = (e && e.status) || 0;
      if (status === 403 || status === 503) {
        const { html, status: browserStatus } = await fetchViaBrowser(u);
        if (browserStatus && browserStatus >= 400) {
          const err = new Error(
            `Exam server returned HTTP ${browserStatus} even in a real Chrome window — wait a minute and try again.`
          );
          err.status = browserStatus;
          throw err;
        }
        return html;
      }
      throw e;
    }
  };

  const fetchOne = async (u, i) => {
    let lastError = 'Fetch failed.';
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const text = await fetchPartHtml(u);
        const parsed = parsePart(text, u, opts);
        if (parsed.valid) {
          results[i] = { ok: true, parsed };
          return;
        }
        // HTTP 200 but not a response sheet — usually a throttle/challenge
        // interstitial. Wait a beat and try again.
        lastError = `The page loaded but did not contain a response sheet (${parsed.invalidHint}) — the link may have expired or been used already.`;
      } catch (e) {
        lastError = (e && e.message) || 'Fetch failed.';
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    results[i] = { ok: false, error: lastError };
  };

  // Part A first — its response doubles as the cookie warm-up. (The previous
  // version fetched ViewCandResponse.aspx twice back-to-back, which the site
  // intermittently throttles — that was the random missing-part bug.)
  await fetchOne(urls[0], 0);

  // Then B, C, D sequentially with a small gap — Cloudflare throttles bursts.
  for (let i = 1; i < urls.length; i++) {
    await new Promise((r) => setTimeout(r, 350));
    await fetchOne(urls[i], i);
  }

  const okParts = results.filter((r) => r && r.ok);

  // If a later part came back byte-identical to an earlier one, the exam simply
  // has fewer parts than links — surface that as a warning rather than duplicating.
  const seen = new Set();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!r || !r.ok) continue;
    if (seen.has(r.parsed.dedupeKey)) {
      r.ok = false;
      r.error = `The server returned the same content as an earlier part — this paper appears to have fewer than 4 parts.`;
    } else {
      seen.add(r.parsed.dedupeKey);
    }
  }

  const succeeded = results.filter((r) => r && r.ok);

  if (!succeeded.length) {
    const err = results.find((r) => r && r.error);
    return res.status(422).json({ error: (err && err.error) || 'Could not read a response sheet from this link.' });
  }

  const firstParsed = succeeded[0].parsed;

  // Some sessions render Part A's date/time cells empty while B–D carry them —
  // fill the gaps so previews and the PDF header show exam date + shift.
  if (!firstParsed.meta.testDate) {
    const dateSource = succeeded.find((r) => r.parsed.meta.testDate);
    if (dateSource) {
      firstParsed.meta.testDate = dateSource.parsed.meta.testDate;
      firstParsed.meta.testTime = dateSource.parsed.meta.testTime || firstParsed.meta.testTime;
      firstParsed.meta.shift = dateSource.parsed.meta.shift || firstParsed.meta.shift;
      firstParsed.meta.shiftTime = dateSource.parsed.meta.shiftTime || firstParsed.meta.shiftTime;
      firstParsed.infoHtml = patchInfoCard(firstParsed.infoHtml, {
        testDate: firstParsed.meta.testDate,
        testTime: firstParsed.meta.testTime,
      });
    }
  }

  const meta = { ...firstParsed.meta };
  const totalQuestions = succeeded.reduce((n, r) => n + r.parsed.meta.questionCount, 0);
  const filename = buildFilename(meta);

  const id = store.create({
    baseUrl: urls[0],
    opts,
    meta,
    filename,
    parts: results.map((r) => (r && r.ok ? r.parsed : null)),
    parsedOpts: opts,
  });

  res.json({
    id,
    meta: { ...meta, totalQuestions, partsFound: succeeded.length },
    filename,
    warnings: results.map((r) => (!r || !r.ok ? r.error || null : null)),
    parts: results.map((r, i) =>
      r && r.ok
        ? {
            key: PART_KEYS[i],
            label: `Part ${PART_KEYS[i]}`,
            subject: r.parsed.meta.subjectText,
            questionCount: r.parsed.meta.questionCount,
            ok: true,
          }
        : { key: PART_KEYS[i], label: `Part ${PART_KEYS[i]}`, ok: false, error: (r && r.error) || 'Failed.' }
    ),
  });
});

app.get('/api/part/:id/:key', requireAuth, (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session expired. Please process the link again.' });
  const idx = PART_KEYS.indexOf(String(req.params.key).toUpperCase());
  if (idx < 0) return res.status(400).json({ error: 'Unknown part.' });
  const parsed = s.parts[idx];
  if (!parsed) return res.status(404).json({ error: 'This part was not available.' });
  res.json({ html: partViewHtml(parsed, s.parsedOpts) });
});

app.get('/api/view/:id', requireAuth, (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).send('Session expired. Please process the link again.');
  const parts = s.parts.filter(Boolean);
  if (!parts.length) return res.status(404).send('No parts available.');
  res.type('html').send(combinedHtml(parts, s.parsedOpts));
});

app.get('/api/pdf/:id', requireAuth, async (req, res) => {
  const s = store.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session expired. Please process the link again.' });
  const parts = s.parts.filter(Boolean);
  if (!parts.length) return res.status(404).json({ error: 'No parts available.' });

  try {
    const { domain } = new URL(s.baseUrl);
    const jar = new CookieJar();
    let cookies = [];
    try {
      const { text } = await fetchText(s.baseUrl, { jar, referer: s.baseUrl, timeoutMs: 45000 });
      void text; // warm the session cookie so image requests are treated like a normal visit
      cookies = jar.toPuppeteerCookies(domain);
    } catch (e) {
      // not fatal — images are usually served without a session
    }

    const pdf = await renderPdf(combinedHtml(parts, s.parsedOpts), { cookies });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Length', pdf.length);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${s.filename.replace(/["\\]/g, '')}"; filename*=UTF-8''${encodeURIComponent(s.filename)}`
    );
    res.send(pdf);
  } catch (e) {
    console.error('[pdf] render failed:', e);
    res.status(500).json({
      error:
        'PDF rendering failed. You can still use "Open print view" and save as PDF from the browser print dialog.',
    });
  }
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) res.status(404).json({ error: 'Not found.' });
  else res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n  SSC Response Sheet Cleaner running at  http://localhost:${PORT}\n`);
});
