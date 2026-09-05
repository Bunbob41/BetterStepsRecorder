const $ = (id) => document.getElementById(id);

const el = {
  record: $('btn-record'), pause: $('btn-pause'), stop: $('btn-stop'), open: $('btn-open'),
  dot: $('dot'), status: $('status-text'), list: $('step-list'), count: $('count'),
  empty: $('empty'), detailEmpty: $('detail-empty'), detailBody: $('detail-body'),
  text: $('detail-text'), meta: $('detail-meta'), del: $('btn-delete'),
  rerecord: $('btn-rerecord'), arming: $('arming'), armingN: $('arming-n'),
  armingCancel: $('arming-cancel'),
  shot: $('shot'), indicator: $('indicator'),
  saveState: $('save-state'), reveal: $('btn-reveal'),
  settingsBtn: $('btn-settings'), dialog: $('settings'),
  root: $('set-root'), browse: $('set-browse'), format: $('set-format'),
  quality: $('set-quality'), qualityVal: $('set-quality-val'),
  qualityField: $('quality-field'),
  scale: $('set-scale'), scaleVal: $('set-scale-val'), setClose: $('set-close'),
  keyboard: $('set-keyboard'),
  brand: $('set-brand'), logo: $('set-logo'), logoPick: $('set-logo-pick'),
  logoClear: $('set-logo-clear'), footer: $('set-footer'),
  blur: $('btn-blur'), wrap: $('shot-wrap'), selection: $('selection'),
  exportBtn: $('btn-export'), exportDlg: $('exportdlg'),
  expTitle: $('exp-title'), expFormat: $('exp-format'),
  expGo: $('exp-go'), expCancel: $('exp-cancel'),
  scopeBtn: $('btn-scope'), scopeDlg: $('scopedlg'), scopeList: $('scope-list'),
  scopeRefresh: $('scope-refresh'), scopeCancel: $('scope-cancel'), scopeGo: $('scope-go'),
  note: $('btn-note'), exclude: $('chk-exclude'), frame: $('set-frame'),
  sessionName: $('session-name'), libraryList: $('library-list'),
  libraryEmpty: $('library-empty'),
  compactBar: $('compactbar'), cDot: $('c-dot'), cState: $('c-state'),
  cCount: $('c-count'), cPause: $('c-pause'), cStop: $('c-stop'),
};

let steps = [];
let selectedId = null;
let marked = new Set();      // multi-selection for trimming
let state = 'idle';   // idle | recording | paused

// ---- rendering --------------------------------------------------------------

function setState(next) {
  state = next;
  el.cDot.className = 'dot ' + (next === 'recording' ? 'rec' : next === 'paused' ? 'paused' : 'idle');
  el.cState.textContent = next === 'paused' ? 'Paused' : 'Recording';
  el.cPause.textContent = next === 'paused' ? 'Resume' : 'Pause';
  el.dot.className = 'dot ' + (next === 'recording' ? 'rec' : next === 'paused' ? 'paused' : 'idle');
  el.status.textContent =
    next === 'recording' ? 'Recording' : next === 'paused' ? 'Paused' : 'Idle';

  el.record.disabled = next !== 'idle';
  // Safety net: idle and compact is a dead end, so never allow the pair.
  if (next === 'idle' && document.body.classList.contains('compact')) {
    window.bsr.restoreWindow();
  }
  el.pause.disabled = next === 'idle';
  el.stop.disabled = next === 'idle';
  el.pause.textContent = next === 'paused' ? 'Resume' : 'Pause';
  el.open.disabled = next !== 'idle';
  el.scopeBtn.disabled = next !== 'idle';
}

function renderList() {
  el.count.textContent = String(steps.length);
  el.del.textContent = marked.size > 1 ? `Delete ${marked.size} steps` : 'Delete step';
  const recorded = steps.filter((s) => s.action !== 'note').length;
  el.cCount.textContent = `${recorded} step${recorded === 1 ? '' : 's'}`;
  el.empty.hidden = steps.length > 0;
  el.list.replaceChildren();

  let number = 0;
  steps.forEach((s, i) => {
    const isNote = s.action === 'note';

    const li = document.createElement('li');
    li.className = 'step'
      + (s.id === selectedId ? ' selected' : '')
      + (marked.has(s.id) ? ' marked' : '')
      + (s.excluded ? ' excluded' : '')
      + (isNote ? ' note' : '');
    li.dataset.id = s.id;
    li.dataset.index = String(i);
    li.draggable = true;

    const n = document.createElement('div');
    n.className = 'n';
    // Notes carry no number: they are asides, not steps the reader counts.
    n.textContent = isNote ? '•' : String(++number);

    const label = document.createElement('div');
    label.className = 'label';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = s.text || s.action;

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = isNote
      ? (s.excluded ? 'note · excluded' : 'note')
      : [s.window?.process, s.action, s.excluded ? 'excluded' : null]
          .filter(Boolean).join(' · ');

    label.append(title, sub);
    li.append(n, label);
    li.addEventListener('click', (e) => {
      if (e.ctrlKey || e.metaKey) {
        // Toggle one step into the trimming selection.
        marked.has(s.id) ? marked.delete(s.id) : marked.add(s.id);
        renderList();
        return;
      }
      if (e.shiftKey && selectedId) {
        // Extend from the anchor, which is how every list in Windows behaves.
        const from = steps.findIndex((x) => x.id === selectedId);
        const to = i;
        marked = new Set(steps.slice(Math.min(from, to), Math.max(from, to) + 1)
                              .map((x) => x.id));
        renderList();
        return;
      }
      marked = new Set([s.id]);
      select(s.id);
    });
    attachDrag(li);
    el.list.append(li);
  });
}

async function select(id) {
  selectedId = id;
  renderList();

  const step = steps.find((s) => s.id === id);
  if (!step) return;

  el.detailEmpty.hidden = true;
  el.detailBody.hidden = false;
  el.text.value = step.text || '';
  el.exclude.checked = !!step.excluded;

  const isNote = step.action === 'note';
  // A written step has no screenshot, so the tools that act on one are moot.
  el.blur.hidden = isNote;
  el.rerecord.hidden = isNote;
  el.text.placeholder = isNote ? 'Describe what the reader should do' : '';
  el.meta.textContent = [
    `Step ${steps.indexOf(step) + 1}`,
    step.action,
    step.window?.title ? `"${step.window.title}"` : null,
    `${step.point.x}, ${step.point.y}`,
    step.monitor ? `${Math.round(step.monitor.scale * 100)}% scaling` : null,
    step.rerecordedAt ? 're-recorded' : null,
    step.redacted ? 'redacted' : null,
  ].filter(Boolean).join('   ·   ');

  el.indicator.style.display = 'none';

  if (isNote) {
    el.shot.removeAttribute('src');
    el.meta.textContent = 'Written step — appears in the guide without a screenshot';
    return;
  }

  const url = await window.bsr.shotUrl(step.screenshot);
  // Cache-bust: a re-recorded step swaps the file behind the same <img>.
  // Query, not fragment: a fragment is not part of the cache key, so blurring 
  // in place (same filename) would keep showing the unredacted image.
  const version = encodeURIComponent(`${step.rerecordedAt || ''}-${step.editedAt || ''}`);
  el.shot.src = url ? `${url}?v=${version}` : '';
  el.shot.onload = () => placeIndicator(step);
}

/**
 * The screenshot covers the window rect in physical pixels; the click point is
 * in physical virtual-desktop pixels. Subtract the window origin to get the
 * offset inside the image, then scale by however much the <img> is displayed at.
 * Doing this in CSS pixels instead is what makes indicators drift on scaled displays.
 */
function placeIndicator(step) {
  // The frame actually captured. With monitor or full-screen framing the
  // screenshot is bigger than the window, so window-relative maths is wrong.
  const rect = (step.frame?.w ? step.frame : null) || step.window?.rect;
  if (!rect || !el.shot.naturalWidth) return;

  const ratio = el.shot.clientWidth / el.shot.naturalWidth;
  const x = (step.point.x - rect.x) * ratio;
  const y = (step.point.y - rect.y) * ratio;

  if (x < 0 || y < 0 || x > el.shot.clientWidth || y > el.shot.clientHeight) return;

  el.indicator.style.left = `${x}px`;
  el.indicator.style.top = `${y}px`;
  el.indicator.style.display = 'block';
}

// ---- actions ----------------------------------------------------------------

el.record.addEventListener('click', async () => {
  const r = await window.bsr.startRecording();
  if (!r.ok) { alert(r.error); return; }
  steps = [];
  selectedId = null;
  el.sessionName.value = r.name || '';
  renderList();
  setState('recording');
});

el.pause.addEventListener('click', async () => {
  if (state === 'paused') { await window.bsr.resumeRecording(); setState('recording'); }
  else { await window.bsr.pauseRecording(); setState('paused'); }
});

el.stop.addEventListener('click', async () => {
  await window.bsr.stopRecording();
  setState('idle');
  renderLibrary();
});

el.open.addEventListener('click', async () => {
  const r = await window.bsr.openSession();
  if (!r.ok) return;
  el.saveState.textContent = `${r.steps.length} steps · ${r.dir}`;
  el.reveal.disabled = false;
  steps = r.steps;
  selectedId = null;
  el.detailBody.hidden = true;
  el.detailEmpty.hidden = false;
  renderList();
});

async function deleteSelection() {
  const ids = marked.size ? [...marked] : (selectedId ? [selectedId] : []);
  if (!ids.length) return;

  // One call, so the whole selection is a single undoable action.
  const r = await window.bsr.removeSteps(ids);
  if (!r.ok) return;

  steps = r.steps;
  marked.clear();
  selectedId = null;
  el.detailBody.hidden = true;
  el.detailEmpty.hidden = false;
  renderList();
  renderLibrary();
}

el.del.addEventListener('click', deleteSelection);

// ---- keyboard ------------------------------------------------------------------
// Editing forty steps with the mouse alone is the difference between a tool
// people use and one they abandon halfway through a recording.

document.addEventListener('keydown', async (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);

  // A modal is a modal: undoing behind Settings or Export changes the recording
  // where the user cannot see it happen.
  if (document.querySelector('dialog[open]')) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    const r = await window.bsr.undo();
    if (r.empty) return;
    if (!r.ok) { alert(r.error || 'Nothing to undo.'); return; }
    steps = r.steps;
    renderList();
    if (selectedId && steps.some((s) => s.id === selectedId)) select(selectedId);
    return;
  }

  if (typing) return;

  if (e.key === 'Delete') { e.preventDefault(); deleteSelection(); return; }

  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    if (!steps.length) return;
    const at = steps.findIndex((s) => s.id === selectedId);
    const next = e.key === 'ArrowDown'
      ? Math.min(steps.length - 1, at + 1)
      : Math.max(0, at <= 0 ? 0 : at - 1);
    marked = new Set([steps[next].id]);
    select(steps[next].id);
    document.querySelector('.step.selected')?.scrollIntoView({ block: 'nearest' });
  }
});

let saveTimer = null;
el.text.addEventListener('input', () => {
  const id = selectedId;
  clearTimeout(saveTimer);
  // Debounced: every keystroke would otherwise rewrite session.json.
  saveTimer = setTimeout(async () => {
    const step = steps.find((s) => s.id === id);
    if (!step) return;
    step.text = el.text.value;
    await window.bsr.updateStep(id, { text: el.text.value });
    renderList();
  }, 300);
});

// ---- events from the capture engine ----------------------------------------

window.bsr.onStep(({ replaced, index, step }) => {
  if (replaced) steps[index] = step; else steps.push(step);
  renderList();

  // Follow the newest step unless the user is reading an older one.
  if (!selectedId || replaced) select(step.id);
  else el.list.lastElementChild?.scrollIntoView({ block: 'nearest' });
});

// There is no Save button by design: every step is flushed to disk as it is
// recorded. This bar exists so that is visible rather than merely true.
window.bsr.onSaved(({ dir, count }) => {
  el.saveState.replaceChildren();
  const tick = document.createElement('span');
  tick.className = 'ok';
  tick.textContent = '✓ Saved';
  const rest = document.createElement('span');
  rest.textContent = ` · ${count} step${count === 1 ? '' : 's'} · `;
  const path = document.createElement('span');
  path.className = 'path';
  path.textContent = dir;
  el.saveState.append(tick, rest, path);
  el.reveal.disabled = false;
});

el.reveal.addEventListener('click', () => window.bsr.revealSession());

window.bsr.onError((m) => {
  console.error('[capture]', m);
  alert(`Capture engine error (${m.code}): ${m.message}`);
  setState('idle');
});

window.bsr.onExit(() => setState('idle'));
window.bsr.onLog((m) => console.log('[capture]', m.level, m.message));

// ---- re-record ----------------------------------------------------------------
// Guides rot: one dialog changes and a forty-step SOP is quietly wrong. This
// refreshes a single step in place, keeping every other step and the user's
// own wording.

el.rerecord.addEventListener('click', async () => {
  if (!selectedId) return;
  const step = steps.find((s) => s.id === selectedId);
  el.armingN.textContent = String(steps.indexOf(step) + 1);
  el.arming.hidden = false;

  const r = await window.bsr.rerecordStep(selectedId);
  el.arming.hidden = true;

  if (!r.ok) { alert(r.error); return; }
});

el.armingCancel.addEventListener('click', () => { el.arming.hidden = true; });

window.bsr.onReplaced(({ index, step }) => {
  steps[index] = step;
  renderList();
  if (selectedId === step.id) select(step.id);
});




// ---- library ------------------------------------------------------------------
// The empty state used to say "select a step" over nothing at all. Opening onto
// your own recordings is the difference between an app and a blank window.

async function renderLibrary() {
  const rows = await window.bsr.listLibrary();
  el.libraryList.replaceChildren();
  el.libraryEmpty.hidden = rows.length > 0;

  for (const r of rows.slice(0, 12)) {
    const row = document.createElement('div');
    row.className = 'lib-row';

    const name = document.createElement('div');
    name.className = 'lib-name';
    name.textContent = r.name || 'Untitled recording';

    // The application, not the date: a recording named by default already
    // carries its timestamp, and printing it twice reads as a mistake.
    const meta = document.createElement('div');
    meta.className = 'lib-meta';
    meta.textContent = r.app || 'No application recorded';

    const count = document.createElement('div');
    count.className = 'lib-count';
    const n = document.createElement('div');
    n.textContent = `${r.steps} step${r.steps === 1 ? '' : 's'}`;
    const when = document.createElement('div');
    when.className = 'lib-when';
    when.textContent = r.savedAt ? new Date(r.savedAt).toLocaleString() : '';
    count.append(n, when);

    row.append(name, meta, count);
    row.addEventListener('click', async () => {
      const res = await window.bsr.openLibrary(r.dir);
      if (!res.ok) { alert(res.error); renderLibrary(); return; }
      steps = res.steps;
      selectedId = null;
      el.sessionName.value = res.name || '';
      el.saveState.textContent = `${res.steps.length} steps · ${res.dir}`;
      el.reveal.disabled = false;
      renderList();
      if (steps.length) select(steps[0].id);
    });
    el.libraryList.append(row);
  }
}

let renameTimer = null;
el.sessionName.addEventListener('input', () => {
  clearTimeout(renameTimer);
  renameTimer = setTimeout(() => window.bsr.renameSession(el.sessionName.value), 400);
});

// ---- reorder ------------------------------------------------------------------
// A recording comes out in the order things happened, which is not always the
// order a reader needs. session.reorder() has existed and been tested since the
// first version; this finally connects it.

let dragId = null;

function attachDrag(li) {
  li.addEventListener('dragstart', (e) => {
    dragId = li.dataset.id;
    li.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    // Firefox refuses to start a drag without payload.
    e.dataTransfer.setData('text/plain', dragId);
  });

  li.addEventListener('dragend', () => {
    dragId = null;
    li.classList.remove('dragging');
    clearDropHints();
  });

  li.addEventListener('dragover', (e) => {
    if (!dragId || li.dataset.id === dragId) return;
    e.preventDefault();
    const box = li.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    clearDropHints();
    li.classList.add(after ? 'dropafter' : 'dropbefore');
  });

  li.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (!dragId || li.dataset.id === dragId) return;

    const from = steps.findIndex((s) => s.id === dragId);
    const box = li.getBoundingClientRect();
    const after = e.clientY > box.top + box.height / 2;
    let to = Number(li.dataset.index) + (after ? 1 : 0);

    // Removing the dragged item first shifts every later index down by one.
    if (from < to) to -= 1;
    clearDropHints();
    if (from === -1 || from === to) return;

    const [moved] = steps.splice(from, 1);
    steps.splice(to, 0, moved);
    renderList();
    await window.bsr.reorderStep(from, to);
  });
}

function clearDropHints() {
  for (const node of document.querySelectorAll('.dropbefore, .dropafter')) {
    node.classList.remove('dropbefore', 'dropafter');
  }
}

// ---- written steps ------------------------------------------------------------

el.note.addEventListener('click', async () => {
  const r = await window.bsr.addNote('', selectedId);
  if (!r) { alert('Open or start a recording first.'); return; }

  steps.splice(r.index, 0, r.step);
  renderList();
  select(r.step.id);
  el.text.focus();     // it is empty on purpose: the user types the instruction
});

// ---- exclude from export ------------------------------------------------------

el.exclude.addEventListener('change', async () => {
  if (!selectedId) return;
  const step = steps.find((s) => s.id === selectedId);
  if (!step) return;

  step.excluded = el.exclude.checked;
  await window.bsr.updateStep(step.id, { excluded: step.excluded });
  renderList();
});

// ---- capture scope ------------------------------------------------------------
// Recording everything means documenting one system also captures whatever else
// is on screen. Scoping drops out-of-scope events in the engine, before any
// screenshot is taken - they are never captured, not captured then filtered.

let scopeChoice = { pids: [], label: 'Everything' };

function renderScopeList(windows) {
  el.scopeList.replaceChildren();

  const row = (value, title, sub, checked) => {
    const label = document.createElement('label');
    label.className = 'scope-row';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'scope';
    input.value = value;
    input.checked = checked;
    const box = document.createElement('span');
    const t = document.createElement('div');
    t.className = 't';
    t.textContent = title;
    const p = document.createElement('div');
    p.className = 'p';
    p.textContent = sub;
    box.append(t, p);
    label.append(input, box);
    el.scopeList.append(label);
  };

  row('', 'Everything', 'Every application on screen', scopeChoice.pids.length === 0);

  if (!windows.length) {
    const empty = document.createElement('div');
    empty.className = 'scope-empty';
    empty.textContent = 'No other windows found.';
    el.scopeList.append(empty);
    return;
  }

  // One row per process, not per window: dialogs and child windows of the same
  // application must stay in scope or half the recording silently vanishes.
  const byPid = new Map();
  for (const w of windows) {
    if (!byPid.has(w.pid)) byPid.set(w.pid, w);
  }
  for (const w of byPid.values()) {
    row(String(w.pid), w.title, `${w.process} · pid ${w.pid}`,
        scopeChoice.pids.includes(w.pid));
  }
}

async function openScope() {
  el.scopeList.replaceChildren();
  const loading = document.createElement('div');
  loading.className = 'scope-empty';
  loading.textContent = 'Looking for open windows…';
  el.scopeList.append(loading);
  el.scopeDlg.showModal();

  const r = await window.bsr.listWindows();
  renderScopeList(r.ok ? r.windows : []);
}

el.scopeBtn.addEventListener('click', openScope);
el.scopeRefresh.addEventListener('click', openScope);
el.scopeCancel.addEventListener('click', () => el.scopeDlg.close());

el.scopeGo.addEventListener('click', async () => {
  const picked = el.scopeList.querySelector('input[name=scope]:checked');
  const value = picked ? picked.value : '';

  if (!value) {
    scopeChoice = { pids: [], label: 'Everything' };
  } else {
    const row = picked.parentElement.querySelector('.p').textContent;
    scopeChoice = { pids: [Number(value)], label: row.split(' · ')[0] };
  }

  await window.bsr.setScope(scopeChoice.pids, scopeChoice.label);
  el.scopeBtn.textContent = `Capture: ${scopeChoice.label}`;
  el.scopeDlg.close();
});

// ---- global hotkeys -----------------------------------------------------------

// The window shrinks to a floating strip while recording; the editor markup
// stays in the DOM so returning is instant and selection survives.
window.bsr.onUndoDepth(({ depth }) => {
  el.del.textContent = marked.size > 1 ? `Delete ${marked.size} steps` : 'Delete step';
  el.del.title = depth ? `${depth} change${depth === 1 ? '' : 's'} can be undone (Ctrl+Z)` : '';
});

window.bsr.onMode(({ compact }) => {
  document.body.classList.toggle('compact', compact);
  el.compactBar.hidden = !compact;

  // The repaint after the resize is forced in the main process; the DOM here
  // was never wrong.
});

el.cPause.addEventListener('click', () => { if (!el.pause.disabled) el.pause.click(); });

el.cStop.addEventListener('click', async () => {
  // Not el.stop.click(): the toolbar button is disabled while idle, so
  // delegating to it left the strip with a Stop that did nothing.
  await window.bsr.stopRecording();
  setState('idle');
  renderLibrary();
});

window.bsr.onHotkey(({ action }) => {
  if (action === 'paused') setState('paused');
  else if (action === 'resumed') setState('recording');
  else if (action === 'stopped') setState('idle');
});

// ---- blur ---------------------------------------------------------------------
// Destructive by design: the pixels are replaced in the file on disk. An overlay
// that merely covered them would leave the real data in the session folder, and
// a redacted guide whose sources still contain the data is worse than none.

let blurArming = false;
let dragStart = null;

el.blur.addEventListener('click', () => {
  blurArming = !blurArming;
  el.blur.classList.toggle('active', blurArming);
  el.wrap.classList.toggle('selecting', blurArming);
  el.selection.hidden = true;
});

el.wrap.addEventListener('mousedown', (e) => {
  if (!blurArming || !selectedId) return;
  e.preventDefault();
  const r = el.shot.getBoundingClientRect();
  dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  Object.assign(el.selection.style, { left: `${dragStart.x}px`, top: `${dragStart.y}px`,
                                      width: '0px', height: '0px' });
  el.selection.hidden = false;
});

window.addEventListener('mousemove', (e) => {
  if (!dragStart) return;
  const r = el.shot.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
  const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
  Object.assign(el.selection.style, {
    left: `${Math.min(x, dragStart.x)}px`,
    top: `${Math.min(y, dragStart.y)}px`,
    width: `${Math.abs(x - dragStart.x)}px`,
    height: `${Math.abs(y - dragStart.y)}px`,
  });
});

window.addEventListener('mouseup', async (e) => {
  if (!dragStart) return;

  const r = el.shot.getBoundingClientRect();
  const x = Math.max(0, Math.min(e.clientX - r.left, r.width));
  const y = Math.max(0, Math.min(e.clientY - r.top, r.height));
  const sel = {
    left: Math.min(x, dragStart.x), top: Math.min(y, dragStart.y),
    width: Math.abs(x - dragStart.x), height: Math.abs(y - dragStart.y),
  };
  dragStart = null;
  el.selection.hidden = true;

  // Ignore a stray click that was not really a drag.
  if (sel.width < 6 || sel.height < 6) return;

  await applyBlur(sel, r.width);
});

async function applyBlur(sel, displayedWidth) {
  const step = steps.find((s) => s.id === selectedId);
  if (!step) return;

  const dataUrl = await window.bsr.shotData(step.screenshot);
  if (!dataUrl) { alert('Could not read the screenshot.'); return; }

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve; img.onerror = reject; img.src = dataUrl;
  });

  // The selection is in displayed CSS pixels; the file is in physical pixels.
  const ratio = img.naturalWidth / displayedWidth;
  const x = Math.round(sel.left * ratio);
  const y = Math.round(sel.top * ratio);
  const w = Math.round(sel.width * ratio);
  const h = Math.round(sel.height * ratio);

  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);

  // Pixelate first, then blur the pixelated block. Blur alone can leave enough
  // structure to read short text back; downsampling actually discards it.
  const sw = Math.max(1, Math.round(w / 16));
  const sh = Math.max(1, Math.round(h / 16));
  const small = document.createElement('canvas');
  small.width = sw; small.height = sh;
  small.getContext('2d').drawImage(img, x, y, w, h, 0, 0, sw, sh);

  ctx.save();
  ctx.filter = 'blur(3px)';
  ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
  ctx.restore();

  const out = canvas.toDataURL('image/png');

  let r;
  try {
    r = await window.bsr.redactStep(step.id, out);
  } catch (err) {
    alert(`Could not blur that area: ${err.message}`);
    return;
  }
  if (!r.ok) { alert(r.error); return; }

  steps[steps.indexOf(step)] = r.step;
  select(step.id);
}

// ---- export -------------------------------------------------------------------

el.exportBtn.addEventListener('click', () => {
  if (!steps.length) { alert('Record something first.'); return; }
  if (!el.expTitle.value) el.expTitle.value = 'Recorded steps';
  el.exportDlg.showModal();
});

el.expCancel.addEventListener('click', () => el.exportDlg.close());

el.expGo.addEventListener('click', async () => {
  el.exportDlg.close();
  const r = await window.bsr.exportSteps(el.expFormat.value, el.expTitle.value);
  if (r.cancelled) return;
  if (!r.ok) { alert(r.error); return; }
  el.saveState.textContent = `Exported to ${r.file}`;
});

// ---- settings ----------------------------------------------------------------

function paintSettings(v) {
  el.root.value = v.saveRoot;
  el.keyboard.checked = v.recordKeyboard !== false;
  el.brand.value = v.brandName || '';
  el.logo.value = v.brandLogo || '';
  el.footer.value = v.brandFooter || '';
  el.format.value = v.imageFormat;
  el.quality.value = v.imageQuality;
  el.qualityVal.textContent = String(v.imageQuality);
  el.frame.value = v.imageFrame || 'window';
  el.scale.value = Math.round(v.imageScale * 100);
  el.scaleVal.textContent = `${Math.round(v.imageScale * 100)}%`;
  // Quality only means anything for a lossy format.
  el.qualityField.style.display = v.imageFormat === 'jpeg' ? 'flex' : 'none';
}

el.settingsBtn.addEventListener('click', async () => {
  paintSettings(await window.bsr.getSettings());
  el.dialog.showModal();
});

el.setClose.addEventListener('click', () => el.dialog.close());

el.browse.addEventListener('click', async () => {
  const r = await window.bsr.chooseFolder();
  if (r.ok) paintSettings(r.values);
});

el.frame.addEventListener('change', async () => {
  await window.bsr.setSettings({ imageFrame: el.frame.value });
});

el.format.addEventListener('change', async () => {
  paintSettings(await window.bsr.setSettings({ imageFormat: el.format.value }));
});

el.keyboard.addEventListener('change', async () => {
  await window.bsr.setSettings({ recordKeyboard: el.keyboard.checked });
});

el.brand.addEventListener('change', async () => {
  await window.bsr.setSettings({ brandName: el.brand.value });
});

el.footer.addEventListener('change', async () => {
  await window.bsr.setSettings({ brandFooter: el.footer.value });
});

el.logoPick.addEventListener('click', async () => {
  const r = await window.bsr.chooseLogo();
  if (r.ok) paintSettings(r.values);
});

el.logoClear.addEventListener('click', async () => {
  paintSettings(await window.bsr.setSettings({ brandLogo: '' }));
});

el.quality.addEventListener('input', () => { el.qualityVal.textContent = el.quality.value; });
el.quality.addEventListener('change', async () => {
  await window.bsr.setSettings({ imageQuality: Number(el.quality.value) });
});

el.scale.addEventListener('input', () => { el.scaleVal.textContent = `${el.scale.value}%`; });
el.scale.addEventListener('change', async () => {
  await window.bsr.setSettings({ imageScale: Number(el.scale.value) / 100 });
});

setState('idle');
renderList();
window.bsr.getSettings().then(paintSettings);
renderLibrary();
window.bsr.getScope().then((s) => {
  scopeChoice = s;
  el.scopeBtn.textContent = `Capture: ${s.label}`;
});
