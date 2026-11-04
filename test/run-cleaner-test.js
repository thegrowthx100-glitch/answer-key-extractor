'use strict';

const fs = require('fs');
const path = require('path');
const { parsePart, partViewHtml, combinedHtml, buildFilename } = require('../lib/cleaner');
const { deriveBranchUrls } = require('../lib/urls');

const html = fs.readFileSync(path.join(__dirname, 'fixture.html'), 'utf8');
const url =
  'https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/ViewCandResponse.aspx?EncKey=cneb041cnebzd';

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}`);
  }
}

console.log('URL derivation:');
const urls = deriveBranchUrls(url);
check('4 branch urls', urls.length === 4);
check(
  'branch urls correct',
  urls.join('\n') ===
    [
      'https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/ViewCandResponse.aspx?EncKey=cneb041cnebzd',
      'https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/ViewCandResponse2.aspx?EncKey=cneb041cnebzd',
      'https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/ViewCandResponse3.aspx?EncKey=cneb041cnebzd',
      'https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/ViewCandResponse4.aspx?EncKey=cneb041cnebzd',
    ].join('\n')
);
const urlsFromB = deriveBranchUrls(
  'https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct14/ViewCandResponse2.aspx?EncKey=6sdFwmM7FzDVu'
);
check('normalizes a Part-B style link', /ViewCandResponse\.aspx/.test(urlsFromB[0]));

console.log('\nParsing (with all toggles default):');
const opts = { removeChallengeLinks: true, removeHindiSwitch: true, keepHeader: true, keepLegend: true };
const p = parsePart(html, url, opts);

check('exam name parsed', p.meta.examName === 'Combined Graduate Level Examination, 2026');
check('test date parsed (13 Oct 2026)', p.meta.testDate === '13 Oct 2026');
check('test time parsed (01:30 PM (Shift-2))', p.meta.testTime === '01:30 PM (Shift-2)');
check('shift parsed (Shift-2)', p.meta.shift === 'Shift-2');
check('part letter A', p.meta.partLetter === 'A');
check('subject parsed', /PART-A \(General Intelligence and Reasoning\)/.test(p.meta.subjectText));
check('question count = 25', p.meta.questionCount === 25);
check('valid', p.valid === true);
check('filename', buildFilename(p.meta) === '13 Oct 2026 (Shift-2).pdf');

const all = [p.infoHtml, p.legendHtml, p.headerHtml, p.questionsHtml].join('\n');
console.log('\nRemovals (locked):');
check('no watermark text (roll no. 326120513976)', !all.includes('326120513976'));
check('no watermark-container', !all.includes('watermark'));
check('no Roll No.', !/Roll No/.test(all));
check('no candidate name (KAUSHAL)', !all.includes('KAUSHAL'));
check('no centre name (AADARSH)', !all.includes('AADARSH'));
check('no Save / Print', !all.includes('Save / Print'));
check('no Undertaking', !all.includes('Undertaking'));
check('no Note/challenge-module box', !all.includes('The candidates may note') && !all.includes('challenge&nbsp;module'));
check('no PART-B/C/D switch buttons', !all.includes('Click Here for PART-B'));
check('no site menu (Logout)', !all.includes('Logout'));
check('no scripts', !/<script/i.test(all));
check('no inline on* handlers', !/\son[a-z]+\s*=/i.test(all));

console.log('\nKeeps:');
check('exam level kept', all.includes('Combined Graduate Level Examination, 2026'));
check('test date kept', all.includes('13 Oct 2026'));
check('test time kept', all.includes('01:30 PM (Shift-2)'));
check('colour legend kept', all.includes('Correct Option selected'));
check('SSC header kept', all.includes('SSC ONLINE EXAMINATION'));
check('question images absolutized', all.includes('https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/qimg/'));

console.log('\nToggleable removals:');
check('no challenge links', !all.includes('Click Here to Challenge'));
check('no Hindi version switches', !all.includes('Hindi version'));

console.log('\nOptions off (keep challenge links + hindi switch, drop header/legend):');
const p2 = parsePart(html, url, { removeChallengeLinks: false, removeHindiSwitch: false, keepHeader: false, keepLegend: false });
const all2 = [p2.infoHtml, p2.legendHtml, p2.headerHtml, p2.questionsHtml].join('\n');
check('challenge links kept', all2.includes('Click Here to Challenge'));
check('hindi switch kept', all2.includes('Hindi version'));
check('header dropped', !all2.includes('SSC ONLINE EXAMINATION'));
check('legend dropped', !all2.includes('Correct Option selected'));
check('challenge link href absolutized', all2.includes('https://sscexams.cbexams.com/CGLE2026jsdgheQchallengemshetsOct13/Challenge_Item.aspx'));

console.log('\nDocuments:');
const view = partViewHtml(p, opts);
check('part view has info + subject + questions', view.includes('info-card') && view.includes('subject-title') && view.includes('questions'));
const combined = combinedHtml([p, p, p, p], opts);
check('combined has page breaks between parts', (combined.match(/class="part page-break"/g) || []).length === 3);
check('combined info card appears once', (combined.match(/class="info-card"/g) || []).length === 1);
check('combined is a full document', combined.startsWith('<!DOCTYPE html>'));

fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'out', 'partA-view.html'), view);
fs.writeFileSync(path.join(__dirname, 'out', 'combined.html'), combined);
console.log('\nWrote test/out/partA-view.html and test/out/combined.html');

if (failures) {
  console.log(`\n${failures} CHECK(S) FAILED`);
  process.exit(1);
}
console.log('\nALL CHECKS PASSED');
