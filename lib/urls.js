'use strict';

// Derives the four part URLs (ViewCandResponse, ...2, ...3, ...4 .aspx) from any
// ViewCandResponse*.aspx link, keeping the original directory and query string.
function deriveBranchUrls(rawUrl) {
  let u;
  try {
    u = new URL(String(rawUrl || '').trim());
  } catch {
    throw new Error('That is not a valid URL. Paste the full response-sheet link, e.g. https://sscexams.cbexams.com/.../ViewCandResponse.aspx?EncKey=...');
  }
  if (!/^https?:$/.test(u.protocol)) {
    throw new Error('Only http(s) links are supported.');
  }
  if (!/ViewCandResponse\d*\.aspx$/i.test(u.pathname)) {
    throw new Error('This does not look like a ViewCandResponse.aspx link. Open your answer-key page and copy its full URL.');
  }
  // ASP.NET query names are case-insensitive — accept EncKey / enckey / EncKey…
  const hasEncKey = [...u.searchParams.keys()].some((k) => k.toLowerCase() === 'enckey');
  if (!hasEncKey) {
    throw new Error('The link is missing its EncKey query parameter. Copy the complete URL from the browser address bar.');
  }

  const dir = u.pathname.replace(/ViewCandResponse\d*\.aspx$/i, '');
  const query = u.search;
  const mk = (n) => `${u.origin}${dir}ViewCandResponse${n === 1 ? '' : n}.aspx${query}`;
  return [mk(1), mk(2), mk(3), mk(4)];
}

module.exports = { deriveBranchUrls };
