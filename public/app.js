'use strict';

const $ = (sel) => document.querySelector(sel);

const el = {
  form: $('#urlForm'),
  urlInput: $('#urlInput'),
  pasteBtn: $('#pasteBtn'),
  optionsToggle: $('#optionsToggle'),
  optionsPanel: $('#optionsPanel'),
  optChallenge: $('#optChallenge'),
  optHindi: $('#optHindi'),
  optHeader: $('#optHeader'),
  optLegend: $('#optLegend'),
  fetchBtn: $('#fetchBtn'),
  statusLine: $('#statusLine'),
  statusText: $('#statusText'),
  errorCard: $('#errorCard'),
  errorText: $('#errorText'),
  results: $('#results'),
  metaChips: $('#metaChips'),
  partChips: $('#partChips'),
  warnBox: $('#warnBox'),
  warnList: $('#warnList'),
  retryBtn: $('#retryBtn'),
  tabs: $('#tabs'),
  docPanel: $('#docPanel'),
  printBtn: $('#printBtn'),
  pdfBtn: $('#pdfBtn'),
  pdfBtnLabel: $('#pdfBtnLabel'),
  dlFilename: $('#dlFilename'),
  resetBtn: $('#resetBtn'),
  toast: $('#toast'),
  loginView: $('#loginView'),
  appMain: $('#appMain'),
  loginForm: $('#loginForm'),
  loginUser: $('#loginUser'),
  loginPass: $('#loginPass'),
  loginBtn: $('#loginBtn'),
  loginError: $('#loginError'),
  logoutBtn: $('#logoutBtn'),
};

let session = null; // { id, meta, filename, parts, warnings }
let activeTab = null;
let busy = false;

/* ---------- helpers ---------- */

function show(elm, on = true) {
  elm.hidden = !on;
}

let toastTimer = null;
function toast(msg) {
  el.toast.textContent = msg;
  show(el.toast, true);
  requestAnimationFrame(() => el.toast.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.classList.remove('show');
    setTimeout(() => show(el.toast, false), 300);
  }, 4200);
}

function setStatus(text) {
  show(el.statusLine, Boolean(text));
  el.statusText.textContent = text || '';
}

function currentOptions() {
  return {
    removeChallengeLinks: el.optChallenge.checked,
    removeHindiSwitch: el.optHindi.checked,
    keepHeader: el.optHeader.checked,
    keepLegend: el.optLegend.checked,
  };
}

/* ---------- options panel ---------- */

el.optionsToggle.addEventListener('click', () => {
  const open = el.optionsToggle.getAttribute('aria-expanded') === 'true';
  el.optionsToggle.setAttribute('aria-expanded', String(!open));
  show(el.optionsPanel, open === false);
});

/* ---------- paste ---------- */

el.pasteBtn.addEventListener('click', async () => {
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      el.urlInput.value = text.trim();
      el.urlInput.focus();
    }
  } catch {
    toast('Clipboard access was blocked — paste manually with Ctrl/Cmd+V.');
    el.urlInput.focus();
  }
});

/* ---------- fetch & clean ---------- */

async function fetchWithTimeout(url, opts = {}, timeoutMs = 180000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error('The app server took too long to respond. Is it still running? (node server.js)');
    }
    if (e instanceof TypeError) {
      throw new Error('Could not reach the app server. Start it with:  node server.js');
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

el.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const url = el.urlInput.value.trim();
  if (!url) return;

  busy = true;
  el.fetchBtn.disabled = true;
  show(el.errorCard, false);
  show(el.results, false);
  setStatus('Contacting exam server…');

  const steps = [
    'Contacting exam server…',
    'Fetching Part A…',
    'Fetching Part B…',
    'Fetching Part C…',
    'Fetching Part D…',
    'Cleaning watermarks & personal details…',
  ];
  let step = 0;
  const timer = setInterval(() => {
    step = Math.min(step + 1, steps.length - 1);
    setStatus(steps[step]);
  }, 1300);
  setStatus(steps[0]);

  try {
    const res = await fetchWithTimeout(
      '/api/process',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, options: currentOptions() }),
      },
      180000
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    clearInterval(timer);
    setStatus('Done ✓');
    setTimeout(() => setStatus(''), 900);
    session = data;
    renderSession();
  } catch (err) {
    clearInterval(timer);
    setStatus('');
    el.errorText.textContent = err.message || 'Something went wrong.';
    show(el.errorCard, true);
  } finally {
    busy = false;
    el.fetchBtn.disabled = false;
  }
});

/* ---------- render session ---------- */

function renderSession() {
  const { meta, filename, parts } = session;

  el.metaChips.innerHTML = '';
  const addChip = (html, hl) => {
    const s = document.createElement('span');
    s.className = 'chip' + (hl ? ' hl' : '');
    s.innerHTML = html;
    el.metaChips.appendChild(s);
  };
  if (meta.examName) addChip(`🎓 <b>${esc(meta.examName)}</b>`);
  if (meta.testDate) addChip(`📅 <b>${esc(meta.testDate)}</b>`);
  if (meta.shift) addChip(`🕐 <b>${esc(meta.shift)}</b>${meta.shiftTime ? ' · ' + esc(meta.shiftTime) : ''}`);
  addChip(`📝 <b>${meta.totalQuestions}</b> questions`, true);
  addChip(`🧩 <b>${meta.partsFound}</b>/4 parts`, true);

  el.partChips.innerHTML = '';
  parts.forEach((p) => {
    const s = document.createElement('span');
    s.className = 'pchip ' + (p.ok ? 'done' : 'fail');
    s.textContent = p.ok ? `✓ Part ${p.key} — ${p.questionCount} Q` : `✕ Part ${p.key}`;
    s.title = p.ok ? p.subject : p.error || '';
    el.partChips.appendChild(s);
  });

  const failed = parts.filter((p) => !p.ok);
  el.warnList.innerHTML = '';
  failed.forEach((p) => {
    const li = document.createElement('li');
    li.textContent = `Part ${p.key} — ${p.error || 'fetch failed'}`;
    el.warnList.appendChild(li);
  });
  show(el.warnBox, failed.length > 0);
  if (failed.length) toast(`${failed.length} part(s) could not be fetched — see the notice above.`);

  el.dlFilename.textContent = `Saves as “${filename}”`;

  // tabs
  el.tabs.innerHTML = '';
  activeTab = null;
  parts.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'tab';
    b.type = 'button';
    b.role = 'tab';
    b.textContent = `Part ${p.key}`;
    b.disabled = !p.ok;
    b.title = p.ok ? p.subject : p.error || '';
    b.addEventListener('click', () => selectTab(p.key));
    b.dataset.key = p.key;
    el.tabs.appendChild(b);
  });

  show(el.results, true);
  const firstOk = parts.find((p) => p.ok);
  if (firstOk) selectTab(firstOk.key);
  el.results.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

async function selectTab(key) {
  if (!session || busy) return;
  activeTab = key;
  el.tabs.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.key === key));

  el.docPanel.classList.add('loading');
  el.docPanel.innerHTML = '';
  try {
    const res = await fetchWithTimeout(`/api/part/${session.id}/${key}`, {}, 30000);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load this part.');
    if (activeTab !== key) return; // user switched away meanwhile
    el.docPanel.innerHTML = data.html;
  } catch (err) {
    el.docPanel.innerHTML = `<p style="color:#c0392b;font-weight:600;">${esc(err.message)}</p>`;
  } finally {
    el.docPanel.classList.remove('loading');
  }
}

/* ---------- PDF & print ---------- */

el.pdfBtn.addEventListener('click', async () => {
  if (!session || busy) return;
  busy = true;
  el.pdfBtn.disabled = true;
  const old = el.pdfBtnLabel.textContent;
  el.pdfBtnLabel.textContent = 'Preparing PDF… (rendering all questions & images)';
  try {
    const res = await fetchWithTimeout(`/api/pdf/${session.id}`, {}, 300000);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'PDF generation failed.');
    }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = session.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    toast(`Saved “${session.filename}” ✓`);
  } catch (err) {
    toast(err.message || 'PDF generation failed.');
  } finally {
    busy = false;
    el.pdfBtn.disabled = false;
    el.pdfBtnLabel.textContent = old;
  }
});

el.printBtn.addEventListener('click', () => {
  if (!session) return;
  window.open(`/api/view/${session.id}`, '_blank', 'noopener');
});

el.retryBtn.addEventListener('click', () => {
  // Re-run the whole fetch with the same URL and options.
  el.form.requestSubmit();
});

el.resetBtn.addEventListener('click', () => {
  session = null;
  activeTab = null;
  show(el.results, false);
  show(el.errorCard, false);
  el.urlInput.value = '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  el.urlInput.focus();
});

/* ---------- auth ---------- */

function setAuthed(on) {
  show(el.loginView, !on);
  show(el.appMain, on);
  show(el.logoutBtn, on);
  if (!on) {
    el.loginPass.value = '';
    show(el.loginError, false);
  }
}

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  el.loginBtn.disabled = true;
  show(el.loginError, false);
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: el.loginUser.value.trim(), password: el.loginPass.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Login failed.');
    setAuthed(true);
  } catch (err) {
    el.loginError.textContent = err.message;
    show(el.loginError, true);
  } finally {
    el.loginBtn.disabled = false;
  }
});

el.logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST' });
  } catch { /* ignore */ }
  setAuthed(false);
});

(async function boot() {
  try {
    const res = await fetch('/api/me');
    const data = await res.json();
    setAuthed(Boolean(data.authenticated));
  } catch {
    setAuthed(false);
  }
})();
