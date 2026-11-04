'use strict';

// Hard safety rail: this tool fetches answer-key pages, so we only talk to the
// exam host (override with ALLOWED_HOST_SUFFIX env if ever needed).
const ALLOWED_HOST_SUFFIX = (process.env.ALLOWED_HOST_SUFFIX || 'cbexams.com').toLowerCase();

function assertAllowedUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('Invalid URL.');
  }
  const host = u.hostname.toLowerCase();
  if (host !== ALLOWED_HOST_SUFFIX && !host.endsWith(`.${ALLOWED_HOST_SUFFIX}`)) {
    throw new Error(`For safety this app only fetches *.${ALLOWED_HOST_SUFFIX} links.`);
  }
}

const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

// Tiny cookie jar: the exam site hands out ASP.NET_SessionId on first hit and
// expects it back on the follow-up part fetches.
class CookieJar {
  constructor() {
    this.map = new Map();
  }

  capture(res) {
    const cookies = (res.headers.getSetCookie && res.headers.getSetCookie()) || [];
    for (const c of cookies) {
      const pair = c.split(';')[0] || '';
      const idx = pair.indexOf('=');
      if (idx > 0) this.map.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  hasAny() {
    return this.map.size > 0;
  }

  toString() {
    return [...this.map.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  toPuppeteerCookies(domain) {
    return [...this.map.entries()].map(([name, value]) => ({ name, value, domain, path: '/' }));
  }
}

async function fetchText(url, { jar, referer, timeoutMs = 45000 } = {}) {
  assertAllowedUrl(url);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers = { ...BROWSER_HEADERS };
    if (referer) headers.Referer = referer;
    if (jar && jar.hasAny()) headers.Cookie = jar.toString();

    const res = await fetch(url, { headers, redirect: 'follow', signal: ctrl.signal });
    if (jar) jar.capture(res);
    if (!res.ok) {
      const err = new Error(`Exam server returned HTTP ${res.status} for this part.`);
      err.status = res.status;
      throw err;
    }
    return { text: await res.text(), finalUrl: res.url };
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('Timed out while contacting the exam server. Please try again.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { assertAllowedUrl, fetchText, CookieJar };
