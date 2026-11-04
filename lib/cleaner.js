'use strict';

const cheerio = require('cheerio');

// Always removed (locked):
//  - watermark container / lblWatermark
//  - Roll No., Candidate Name, Centre Name rows
//  - Save/Print button, Undertaking, "Note:" box, PART-A..D buttons, site menu, spacers
//    (all of these live outside the extracted blocks, so extraction drops them by design)
//
// Toggleable options:
//  removeChallengeLinks  – strip the "Click Here to Challenge Question No.: N" buttons
//  removeHindiSwitch     – strip the dead "Hindi version" postback switches
//  keepHeader            – keep the SSC logo / title banner
//  keepLegend            – keep the green/red/yellow/gray colour legend
const DEFAULT_OPTIONS = {
  removeChallengeLinks: true,
  removeHindiSwitch: true,
  keepHeader: true,
  keepLegend: true,
};

const PART_LETTERS = ['A', 'B', 'C', 'D'];

function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function sanitize($, root) {
  root.find('script, style, noscript, iframe, object, embed, link, meta').remove();
  root.find('input, button, textarea, select').each((_, el) => {
    const $el = $(el);
    if (el.tagName === 'select') {
      const text = norm($el.find('option:selected').text() || $el.find('option').first().text());
      $el.replaceWith($('<span class="exam-name"></span>').text(text));
    } else {
      $el.remove();
    }
  });
  root.find('*').each((_, el) => {
    for (const a of Object.keys(el.attribs || {})) {
      if (/^on/i.test(a)) $(el).removeAttr(a);
    }
  });
}

function absolutize($, baseUrl) {
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src');
    try {
      $(el).attr('src', new URL(src, baseUrl).href);
    } catch { /* leave as-is */ }
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (/^javascript:/i.test(href)) {
      $(el).attr('href', '#');
      return;
    }
    try {
      $(el).attr('href', new URL(href, baseUrl).href);
    } catch { /* leave as-is */ }
  });
}

// "Test Date" style label cells: label sits in one <td>, the ": value" in the next.
function valueAfterLabel($, labelRe) {
  let out = '';
  $('td').each((_, td) => {
    if (out) return;
    const t = norm($(td).text());
    if (labelRe.test(t)) {
      const v = norm($(td).next('td').text()).replace(/^:\s*/, '');
      if (v) out = v;
    }
  });
  return out;
}

function parsePart(html, pageUrl, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const $ = cheerio.load(html);
  absolutize($, pageUrl);

  // ---------- meta ----------
  const examName =
    norm($('#ddltest option:selected').text()) || norm($('#ddltest option').first().text());
  const testDate = valueAfterLabel($, /^Test Date\b/i);
  const testTime = valueAfterLabel($, /^Test Time/i);

  const shiftMatch = testTime.match(/\(\s*Shift\s*-?\s*(\d+)\s*\)/i);
  const shift = shiftMatch ? `Shift-${shiftMatch[1]}` : '';
  const shiftTime = testTime.replace(/\(\s*Shift\s*-?\s*\d+\s*\)/i, '').trim();

  const m = pageUrl.match(/ViewCandResponse(\d*)\.aspx/i);
  const partIndex = Math.min(Math.max(Number(m && m[1] ? m[1] : 1) - 1, 0), 3);
  const partLetter = PART_LETTERS[partIndex];

  const subjectText = norm($('#lblsubject').text()) || `PART-${partLetter}`;

  // Question tables: every innermost <table> holding a "Q.No:" cell, in
  // document order. Parts A–C wrap these in <div id="updHindi">, but other
  // pages (e.g. Part D) place them directly — this handles both layouts.
  const seenTables = new Set();
  const qTables = [];
  $('font.tdtext').each((_, f) => {
    if (!/^Q\.No/i.test(norm($(f).text()))) return;
    const t = $(f).closest('table')[0];
    if (t && !seenTables.has(t)) {
      seenTables.add(t);
      qTables.push(t);
    }
  });

  const questionCount = qTables.length;

  const firstImg = qTables.length ? $(qTables[0]).find('img').first().attr('src') : '';
  const dedupeKey =
    firstImg || qTables.map((t) => norm($(t).text())).join(' ').slice(0, 200);

  const meta = {
    examName,
    testDate,
    testTime,
    shiftTime,
    shift,
    partLetter,
    subjectText,
    questionCount,
  };
  // A response sheet is valid when it has questions. Some sessions render the
  // Part A info card with empty date/time cells (the date appears on B–D), so
  // a missing date must not disqualify the part.
  const valid = questionCount > 0;

  // Help diagnose invalid pages (expired link / throttle interstitial).
  // Skip the watermark span — it sits at the very top of the body and every
  // page "starts with" the roll number text otherwise.
  const pageTitle = norm($('title').first().text());
  const bodyClone = $('body').clone();
  bodyClone.find('script, style, noscript, #lblWatermark').remove();
  const bodyProbe = norm(bodyClone.text()).slice(0, 120);
  const invalidHint = pageTitle
    ? `page title "${pageTitle}"`
    : bodyProbe
      ? `page shows "${bodyProbe}…"`
      : 'page was empty';

  // ---------- extract blocks ----------
  // Candidate info card (inner table holding the Roll No. row)
  let infoHtml = '';
  const rollTd = $('td')
    .filter((_, td) => /^Roll No\.?\s*$/.test(norm($(td).text())))
    .first();
  if (rollTd.length) {
    const table = rollTd.closest('table').clone();
    table.find('tr').each((_, tr) => {
      const t = norm($(tr).text());
      if (/^Roll No\b/i.test(t) || /^Candidate Name\b/i.test(t) || /^Centre\b/i.test(t)) {
        $(tr).remove();
      }
    });
    table.find('tr').each((_, tr) => {
      if (!$(tr).find('td, th').length) $(tr).remove();
    });
    sanitize($, table);
    infoHtml = `<div class="info-card"><table>${$.html(table.find('tbody').length ? table.find('tbody').contents() : table.contents())}</table></div>`;
  }

  // Colour legend (Correct/Wrong/Not Answered)
  let legendHtml = '';
  if (o.keepLegend) {
    // exact match — the outer layout <td> also contains this text as descendant text
    const legendTd = $('td')
      .filter((_, td) => /^Correct Option selected$/.test(norm($(td).text())))
      .first();
    if (legendTd.length) {
      const legendTable = legendTd.closest('table').clone();
      sanitize($, legendTable);
      legendHtml = `<div class="legend">${$.html(legendTable)}</div>`;
    }
  }

  // SSC logo + title banner (first row of the layout table)
  let headerHtml = '';
  if (o.keepHeader) {
    const logoImg = $('img[src*="ssc"]').first();
    if (logoImg.length) {
      const tr = logoImg.closest('tr').clone();
      sanitize($, tr);
      headerHtml = `<div class="doc-header"><table><tr>${$.html(tr.contents())}</tr></table></div>`;
    }
  }

  // Questions: clean each question table individually
  let questionsHtml = '';
  if (qTables.length) {
    const cleaned = qTables
      .map((t) => {
        const q = $(t).clone();
        q.find('tr').each((_, tr) => {
          const $tr = $(tr);
          if (!$tr.find('td, th').length) {
            $tr.remove();
            return;
          }
          const t2 = norm($tr.text());
          if (o.removeChallengeLinks && /Click\s*Here\s*to\s*Challenge/i.test(t2)) {
            $tr.remove();
            return;
          }
          if (o.removeHindiSwitch && $tr.find('.language-switch').length) {
            $tr.remove();
          }
        });
        sanitize($, q);
        return $.html(q);
      })
      .join('\n');
    questionsHtml = `<div class="questions">${cleaned}</div>`;
  }

  return { meta, valid, invalidHint, dedupeKey, infoHtml, legendHtml, headerHtml, questionsHtml };
}

// One part, as shown on a tab in the web UI (mirrors the site: info, legend, heading, questions)
function partViewHtml(parsed, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const bits = [];
  if (o.keepHeader && parsed.headerHtml) bits.push(parsed.headerHtml);
  if (parsed.infoHtml) bits.push(parsed.infoHtml);
  if (o.keepLegend && parsed.legendHtml) bits.push(parsed.legendHtml);
  bits.push(`<h2 class="subject-title">${esc(parsed.meta.subjectText)}</h2>`);
  if (parsed.questionsHtml) bits.push(parsed.questionsHtml);
  return `<div class="doc part-view">${bits.join('\n')}</div>`;
}

// Combined document used for the PDF and the print view:
// header / info / legend once, then every part with its own heading + page break.
function combinedHtml(parsedParts, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts };
  const first = parsedParts[0] || {};
  const head = [];
  if (o.keepHeader && first.headerHtml) head.push(first.headerHtml);
  if (first.infoHtml) head.push(first.infoHtml);
  if (o.keepLegend && first.legendHtml) head.push(first.legendHtml);

  const sections = parsedParts
    .map(
      (p, i) => `
    <section class="part${i > 0 ? ' page-break' : ''}">
      <h2 class="subject-title">${esc(p.meta.subjectText)}</h2>
      ${p.questionsHtml || ''}
    </section>`
    )
    .join('\n');

  return wrapDocument(head.join('\n') + '\n' + sections);
}

function wrapDocument(bodyInner) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>SSC Response Sheet</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; color: #1a1a1a; font-size: 12.5px; }
  .doc { width: 100%; max-width: 880px; margin: 0 auto; }
  .doc-header { margin: 0 0 8px; border-bottom: 2px solid #226785; padding-bottom: 5px; }
  .doc-header table { border: none; width: 100%; }
  .doc-header td { vertical-align: middle; text-align: center; }
  .doc-header td[align="left"] { text-align: left; }
  .doc-header td[align="right"] { text-align: right; }
  .doc-header .mtext { font-weight: 700; font-size: 16px; color: #226785; letter-spacing: 0.5px; }
  .doc-header .bld { font-weight: 700; font-size: 12px; }
  .doc-header img { max-height: 46px; width: auto; }
  .info-card { margin: 0 0 8px; }
  .info-card table { width: 100%; border-collapse: collapse; background: #FBF8F1; }
  .info-card td { border: 1px solid #d8cfc0; padding: 3px 10px; font-size: 11.5px; vertical-align: middle; }
  .info-card .bld { font-weight: 700; }
  .exam-name { font-weight: 700; }
  .legend { margin: 0 0 10px; }
  .legend table { border-collapse: separate; border-spacing: 4px; }
  .legend td { border: 1px solid #999; color: #111; font-size: 10.5px; padding: 2px 10px; }
  .subject-title { font-size: 13.5px; margin: 10px 0 8px; padding: 5px 12px; background: #226785; color: #fff; border-radius: 5px; page-break-after: avoid; }
  .part.page-break { page-break-before: always; }
  .questions table { width: 100% !important; border-collapse: collapse !important; box-shadow: none !important; margin: 0 0 8px !important; border-radius: 0 !important; }
  .questions td { border: 1px solid #b9c6d4 !important; padding: 4px 6px !important; vertical-align: middle; }
  .questions td[bgcolor] { padding: 2px !important; }
  .questions img { max-width: 92%; height: auto; }
  .questions tr { page-break-inside: avoid; }
  .bld { font-weight: 700; }
  .tdtext { font-size: 11.5px; }
</style>
</head>
<body>
<div class="doc">
${bodyInner}
</div>
</body>
</html>`;
}

// Fill empty date/time cells of an info card from another part's parsed meta
// (some sessions leave Part A's cells blank while B–D carry the values).
function patchInfoCard(infoHtml, patch) {
  if (!infoHtml || (!patch.testDate && !patch.testTime)) return infoHtml;
  const $ = cheerio.load(infoHtml);
  $('td').each((_, td) => {
    const label = norm($(td).text());
    const next = $(td).next('td');
    const value = norm(next.text()).replace(/^:\s*/, '');
    if (value) return;
    if (/^Test Date\b/i.test(label) && patch.testDate) {
      next.html(':&nbsp;&nbsp;&nbsp;' + esc(patch.testDate));
    } else if (/^Test Time/i.test(label) && patch.testTime) {
      next.html(':&nbsp;&nbsp;&nbsp;' + esc(patch.testTime));
    }
  });
  return $.html();
}

// "13 Oct 2026 (Shift-2).pdf" — falls back gracefully when fields are missing.
function buildFilename(meta) {
  const parts = [meta.testDate, meta.shift && `(${meta.shift})`].filter(Boolean).join(' ');
  const base = (parts || 'response-sheet').replace(/[\\/:*?"<>|]+/g, '').trim();
  return `${base}.pdf`;
}

module.exports = { parsePart, partViewHtml, combinedHtml, buildFilename, patchInfoCard, DEFAULT_OPTIONS };
