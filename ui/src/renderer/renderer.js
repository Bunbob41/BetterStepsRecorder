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
  optTemplate: $('opt-template'),
  templateList: $('set-template-list'),
  template: $('set-template'), templatePick: $('set-template-pick'),
  templateClear: $('set-template-clear'), templateInfo: $('template-info'),
  templateCopy: $('set-template-copy'), templateFolder: $('set-template-folder'),
  blur: $('btn-blur'), wrap: $('shot-wrap'), selection: $('selection'),
  box: $('btn-box'), ellipse: $('btn-ellipse'), arrow: $('btn-arrow'),
  highlight: $('btn-highlight'), dragPreview: $('drag-preview'),
  hueMenu: $('huemenu'),
  exportBtn: $('btn-export'), exportDlg: $('exportdlg'),
  expTitle: $('exp-title'), expFormat: $('exp-format'),
  expGo: $('exp-go'), expCancel: $('exp-cancel'), expNote: $('exp-note'),
  setupDlg: $('setupdlg'), suName: $('su-name'), suTemplate: $('su-template'),
  suTemplateField: $('su-template-field'), suScope: $('su-scope'),
  suGo: $('su-go'), suCancel: $('su-cancel'), suOpenTemplates: $('su-templates-open'),
  scopeBtn: $('btn-scope'), scopeDlg: $('scopedlg'), scopeList: $('scope-list'),
  scopeRefresh: $('scope-refresh'), scopeCancel: $('scope-cancel'), scopeGo: $('scope-go'),
  note: $('btn-note'), check: $('btn-check'), section: $('btn-section'),
  exclude: $('chk-exclude'), frame: $('set-frame'),
  sessionName: $('session-name'), libraryList: $('library-list'),
  libraryEmpty: $('library-empty'),
  compactBar: $('compactbar'), cDot: $('c-dot'), cState: $('c-state'),
  cCount: $('c-count'), cPause: $('c-pause'), cStop: $('c-stop'),
  cElapsed: $('c-elapsed'),
  build: $('build'),
  marker: $('set-marker'), markerBold: $('set-marker-bold'),
  legend: $('set-legend'), legendMeanings: $('legend-meanings'),
  notice: $('notice'), noticeText: $('notice-text'),
  noticeSettings: $('notice-settings'), noticeClose: $('notice-close'),
  keysDlg: $('keysdlg'), kPause: $('k-pause'), kStop: $('k-stop'),
  kError: $('k-error'), kReset: $('k-reset'), kClose: $('k-close'),
  shortcutsBtn: $('btn-shortcuts'), hotkeyHint: $('hotkey-hint'),
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
  if (next === 'idle') stopElapsed();
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
  // Adding a note to nothing, or checking nothing, are not actions.
  el.note.disabled = steps.length === 0;
  el.section.disabled = steps.length === 0;
  el.check.disabled = steps.length === 0;
  el.del.textContent = marked.size > 1 ? `Delete ${marked.size} steps` : 'Delete step';
  const recorded = BsrSections.countSteps(steps);
  el.cCount.textContent = `${recorded} step${recorded === 1 ? '' : 's'}`;
  el.empty.hidden = steps.length > 0;
  el.list.replaceChildren();

  // Offered where the recording changed application, which is usually - not
  // always - where the work changed phase.
  const suggested = new Map(
    BsrSections.suggestions(steps).map((x) => [x.index, x]));

  let number = 0;
  steps.forEach((s, i) => {
    if (suggested.has(i)) el.list.append(suggestionRow(suggested.get(i), i));

    const isSection = BsrSections.isSection(s);
    const isNote = s.action === 'note' || isSection;

    const li = document.createElement('li');
    li.className = 'step'
      + (s.id === selectedId ? ' selected' : '')
      + (marked.has(s.id) ? ' marked' : '')
      + (s.excluded ? ' excluded' : '')
      + (isSection ? ' section' : isNote ? ' note' : '')
      + (isSection && !(s.text || '').trim() ? ' untitled' : '');
    li.dataset.id = s.id;
    li.dataset.index = String(i);
    li.draggable = true;

    const n = document.createElement('div');
    n.className = 'n';
    // Notes carry no number: they are asides, not steps the reader counts.
    n.textContent = isSection ? '§' : isNote ? '•' : String(++number);

    const label = document.createElement('div');
    label.className = 'label';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = isSection
      ? (s.text || '').trim() || 'Untitled section'
      : s.text || s.action;

    const v = s.verify;
    const stale = v && (v.status === 'missing');
    if (stale) li.classList.add('stale');

    const sub = document.createElement('div');
    sub.className = 'sub';
    // A heading says nothing useful underneath itself - the marker and the
    // styling already say what it is, and the word only crowds a short name.
    // A note keeps its label, which distinguishes it from a recorded step.
    sub.textContent = isSection
      ? (s.excluded ? 'excluded'
         : !(s.text || '').trim() ? 'not named yet \u2014 will not appear in the guide'
         : '')
      : isNote
      ? (s.excluded ? 'note · excluded' : 'note')
      : [s.window?.process, s.action, s.excluded ? 'excluded' : null]
          .filter(Boolean).join(' · ');

    if (v && !isNote) {
      const flag = document.createElement('span');
      flag.className = 'flag' + (v.status === 'match' ? ' ok' : '');
      flag.textContent = {
        missing: ' · no longer found',
        match: '',
        appNotRunning: ' · app not running',
        inconclusive: ' · could not check',
        noTarget: '',
      }[v.status] || '';
      if (flag.textContent) sub.append(flag);
    }

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

  const isSection = BsrSections.isSection(step);
  const isNote = step.action === 'note' || isSection;
  // A written step has no screenshot, so the tools that act on one are moot.
  for (const t of ['blur', 'box', 'ellipse', 'arrow', 'highlight']) el[t].hidden = isNote;
  if (isNote && armedTool) armTool(armedTool);   // disarm: nothing to draw on
  el.rerecord.hidden = isNote;
  el.text.placeholder = isSection ? 'Name this phase of the procedure'
                      : isNote ? 'Describe what the reader should do' : '';
  el.indicator.style.display = 'none';
  el.indicator.replaceChildren();

  // Notes are handled before anything reads step geometry. A note has no
  // `point`, and reading it threw part-way through this function, which left
  // the PREVIOUS step's screenshot and details on screen.
  if (isNote) {
    el.shot.removeAttribute('src');
    el.meta.textContent = isSection
      ? 'Section heading — groups the steps below it, and is not numbered'
      : 'Written step — appears in the guide without a screenshot';
    return;
  }

  el.meta.textContent = [
    `Step ${steps.indexOf(step) + 1}`,
    step.action,
    step.window?.title ? `"${step.window.title}"` : null,
    step.point ? `${step.point.x}, ${step.point.y}` : null,
    step.monitor ? `${Math.round(step.monitor.scale * 100)}% scaling` : null,
    step.rerecordedAt ? 're-recorded' : null,
    step.redacted ? 'redacted' : null,
    step.verify ? verifyLabel(step.verify) : null,
  ].filter(Boolean).join('   ·   ');

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
function verifyLabel(v) {
  const when = v.at ? new Date(v.at).toLocaleString() : '';
  return {
    missing: `control no longer found (checked ${when})`,
    match: `still matches (checked ${when})`,
    appNotRunning: 'not checked — app was not running',
    inconclusive: 'could not check reliably',
    noTarget: null,
  }[v.status] || null;
}

/** How the click should be marked, as chosen in Settings. */
let markerOpts = { style: 'circle', bold: false };

function placeIndicator(step) {
  // The frame actually captured. With monitor or full-screen framing the
  // screenshot is bigger than the window, so window-relative maths is wrong.
  const rect = (step.frame?.w ? step.frame : null) || step.window?.rect;
  if (!rect || !el.shot.naturalWidth) return;

  // As a percentage of the captured frame, exactly as the exporter computes it,
  // so what is previewed here is what the document will show.
  const px = ((step.point.x - rect.x) / rect.w) * 100;
  const py = ((step.point.y - rect.y) / rect.h) * 100;
  if (px < 0 || py < 0 || px > 100 || py > 100) return;

  // render(), not html(): a style attribute would be refused by the content
  // policy this window runs under, and the marker would sit at 0,0 unstyled.
  el.indicator.replaceChildren(
    BsrMarker.render({ x: px, y: py }, markerOpts, '#e5484d'));
  el.indicator.style.display = 'block';
}

// ---- actions ----------------------------------------------------------------


// ---- shortcuts -----------------------------------------------------------------
// The two global ones are rebindable, because a chord that is perfect on one
// machine is already taken on another. A rebind has to reach three places: the
// registration, the stored setting, and the capture engine, which suppresses
// them so pressing stop is not recorded as the final step.

function keycaps(accelerator) {
  const frag = document.createDocumentFragment();
  for (const part of String(accelerator || '').split('+').filter(Boolean)) {
    const k = document.createElement('kbd');
    k.textContent = { Control: 'Ctrl', Super: 'Win' }[part] || part;
    frag.append(k);
  }
  return frag;
}

function paintShortcuts(state) {
  el.kPause.replaceChildren(keycaps(state.pause));
  el.kStop.replaceChildren(keycaps(state.stop));

  // A chord that failed to register is one another application owns. Saying so
  // beats leaving the user with a shortcut that silently does nothing.
  for (const [node, active] of [[el.kPause, state.pauseActive],
                                [el.kStop, state.stopActive]]) {
    if (!active) {
      const warn = document.createElement('span');
      warn.textContent = ' in use elsewhere';
      warn.style.color = 'var(--rec)';
      node.append(warn);
    }
  }

  el.hotkeyHint.replaceChildren(keycaps(state.pause));
  el.hotkeyHint.append(' pause');
  const sep = document.createElement('span');
  sep.className = 'sep';
  sep.textContent = '\u00b7';
  el.hotkeyHint.append(sep, keycaps(state.stop), ' stop');
}

async function refreshShortcuts() {
  paintShortcuts(await window.bsr.getShortcuts());
}

el.shortcutsBtn.addEventListener('click', async () => {
  await refreshShortcuts();
  el.kError.hidden = true;
  el.keysDlg.showModal();
});

el.kClose.addEventListener('click', () => el.keysDlg.close());

el.kReset.addEventListener('click', async () => {
  await window.bsr.setShortcut('pause', '');
  const r = await window.bsr.setShortcut('stop', '');
  if (r.state) paintShortcuts(r.state);
  el.kError.hidden = true;
});

let listeningFor = null;

for (const btn of document.querySelectorAll('.k-set')) {
  btn.addEventListener('click', () => {
    const row = btn.closest('.keyrow');
    listeningFor = { which: btn.dataset.which, row, btn, label: btn.textContent };
    row.classList.add('listening');
    btn.textContent = 'Press keys\u2026';
    row.querySelector('.k-keys').textContent = 'waiting for a key combination';
    el.kError.hidden = true;
  });
}

// Captured at the window, ahead of the app's own key handling, so binding to
// something like Ctrl+Z does not also undo an edit on the way past.
window.addEventListener('keydown', async (e) => {
  if (!listeningFor) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') {
    const { row, btn, label } = listeningFor;
    row.classList.remove('listening');
    btn.textContent = label;
    listeningFor = null;
    await refreshShortcuts();
    return;
  }

  const accelerator = acceleratorFrom(e);
  if (!accelerator) return;          // a lone modifier: keep waiting

  const { which, row, btn, label } = listeningFor;
  row.classList.remove('listening');
  btn.textContent = label;
  listeningFor = null;

  const r = await window.bsr.setShortcut(which, accelerator);
  if (!r.ok) {
    el.kError.textContent = r.error;
    el.kError.hidden = false;
    await refreshShortcuts();
    return;
  }
  el.kError.hidden = true;
  paintShortcuts(r.state);
}, true);

/**
 * Mirrors the rule in the main process: a bare letter would swallow that key
 * across the whole machine, so a modifier is required unless it is a function key.
 */
function acceleratorFrom(e) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) return null;

  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  let main = '';
  if (/^F\d{1,2}$/.test(e.key)) main = e.key;
  else if (e.key === ' ' || e.code === 'Space') main = 'Space';
  else if (e.key.length === 1) main = e.key.toUpperCase();
  else if (['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
            'Backspace', 'Tab', 'Enter'].includes(e.key)) main = e.key;
  else return null;

  if (!mods.length && !/^F\d{1,2}$/.test(main)) return null;
  return [...mods, main].join('+');
}

window.bsr.onHotkeys(paintShortcuts);

// ---- advisory notices ----------------------------------------------------------
// Shown after a recording ends, dismissed by the user, and never modal.

function showNotice(message) {
  el.noticeText.textContent = message;
  el.notice.hidden = false;
}

window.bsr.onNotice(({ message }) => showNotice(message));

el.noticeClose.addEventListener('click', () => { el.notice.hidden = true; });

el.noticeSettings.addEventListener('click', async () => {
  el.notice.hidden = true;
  // Exactly what the Settings button does, so the link cannot drift from it.
  paintSettings(await window.bsr.getSettings());
  paintBuild();
  el.dialog.showModal();
});

// ---- elapsed time --------------------------------------------------------------
// In the strip rather than the header: while recording, the strip is the only
// part of this window on screen.

let recordingStarted = null;
let elapsedTimer = null;

function stopElapsed() {
  clearInterval(elapsedTimer);
  elapsedTimer = null;
  recordingStarted = null;
  el.cElapsed.textContent = '';
}

function startElapsed() {
  recordingStarted = Date.now();
  clearInterval(elapsedTimer);
  const tick = () => {
    if (!recordingStarted) return;
    const secs = Math.floor((Date.now() - recordingStarted) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    el.cElapsed.textContent = mm + ':' + ss;
  };
  tick();
  elapsedTimer = setInterval(tick, 1000);
}

// ---- setting out ---------------------------------------------------------------
// What a recording is FOR is decided before it starts, not at export. It changes
// how the steps are worded on the way out, and which template they land in — and
// the person pressing record already knows which of those they are making.

function purposeChosen() {
  const picked = document.querySelector('input[name=purpose]:checked');
  return picked ? picked.value : 'sop';
}

function syncPurpose() {
  // A template only means something for a procedure.
  el.suTemplateField.hidden = purposeChosen() !== 'sop';
}

for (const radio of document.querySelectorAll('input[name=purpose]')) {
  radio.addEventListener('change', syncPurpose);
}

el.suOpenTemplates.addEventListener('click', () => window.bsr.revealTemplates());

async function openSetup() {
  el.suName.value = '';

  const { templates } = await window.bsr.listTemplates();
  el.suTemplate.replaceChildren();
  for (const t of templates) {
    const opt = document.createElement('option');
    opt.value = t.path;
    opt.textContent = t.origin === 'user' ? `${t.name} (${t.kind})` : t.name;
    el.suTemplate.append(opt);
  }
  if (!templates.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No templates found';
    el.suTemplate.append(opt);
  }

  // Scope, chosen here rather than in a separate dialog beforehand.
  el.suScope.replaceChildren();
  const everything = document.createElement('option');
  everything.value = '';
  everything.textContent = 'Everything on screen';
  el.suScope.append(everything);

  const r = await window.bsr.listWindows();
  const seen = new Set();
  for (const w of (r.ok ? r.windows : [])) {
    if (seen.has(w.pid)) continue;
    seen.add(w.pid);
    const opt = document.createElement('option');
    opt.value = String(w.pid);
    opt.textContent = `Only ${w.process} — ${w.title}`;
    el.suScope.append(opt);
  }

  syncPurpose();
  el.setupDlg.showModal();
  el.suName.focus();
}

el.record.addEventListener('click', openSetup);
el.suCancel.addEventListener('click', () => el.setupDlg.close());

el.suGo.addEventListener('click', async () => {
  const purpose = purposeChosen();
  const pid = el.suScope.value;
  const intent = {
    name: el.suName.value.trim(),
    purpose,
    templatePath: purpose === 'sop' ? el.suTemplate.value : '',
    scopePids: pid ? [Number(pid)] : [],
    scopeLabel: pid
      ? el.suScope.selectedOptions[0].textContent.replace(/^Only /, '')
      : 'Everything',
  };
  el.setupDlg.close();

  const r = await window.bsr.startRecording(intent);
  if (!r.ok) { alert(r.error); return; }

  steps = [];
  selectedId = null;
  el.sessionName.value = r.name || '';
  el.scopeBtn.textContent = `Capture: ${r.scope}`;
  el.notice.hidden = true;
  renderList();
  setState('recording');
  startElapsed();
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




// ---- staleness ----------------------------------------------------------------
// Creating a guide is a one-off; keeping it true is the work. Every step already
// carries the automation id of what was clicked, so the running application can
// be asked whether those controls are still there.

el.check.addEventListener('click', async () => {
  if (!steps.length) { alert('Open a recording first.'); return; }

  const original = el.check.textContent;
  el.check.textContent = 'Checking…';
  el.check.disabled = true;
  try {
    const r = await window.bsr.verifySession();
    if (!r.ok) { alert(r.error); return; }

    steps = r.steps;
    renderList();

    const t = r.tally || {};
    const stale = t.missing || 0;
    const notRunning = t.appNotRunning || 0;
    const parts = [];
    parts.push(stale
      ? `${stale} of ${r.checked} steps no longer match`
      : `all ${r.checked} checked steps still match`);
    if (notRunning) parts.push(`${notRunning} could not be checked (app not running)`);
    el.saveState.textContent = parts.join(' · ');

    // Deliberately not an alert: a routine result should not freeze the window,
    // and the marked rows already say which steps are affected. The remedy is
    // named in the status line instead.
    if (stale) {
      el.saveState.textContent = parts.join(' · ')
        + ' — select one and use "Re-record step"';
    }
  } finally {
    el.check.textContent = original;
    el.check.disabled = false;
  }
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

// ---- sections ----------------------------------------------------------------
// A heading groups the steps below it into a phase. It is inserted as a row of
// its own rather than set as a property of the step it precedes, so it survives
// that step being re-recorded or deleted.

/** An application's name as a person would write it: "chrome.exe" -> "Chrome". */
function phaseName(app) {
  const base = String(app || '').replace(/\.exe$/i, '').replace(/[_-]+/g, ' ').trim();
  return base ? base.charAt(0).toUpperCase() + base.slice(1) : '';
}

async function addSection(text, afterId) {
  const r = await window.bsr.addSection(text, afterId);
  if (!r) { alert('Open or start a recording first.'); return null; }

  steps.splice(r.index, 0, r.step);
  renderList();
  await select(r.step.id);
  // Empty on purpose, like a note: the name of a phase is what the reader is
  // being told, and no default we could invent is that. Selected as well as
  // focused so a heading created with a name can be typed straight over.
  el.text.focus();
  el.text.select();
  return r.step;
}

el.section.addEventListener('click', () => addSection('', selectedId));

/**
 * The offer itself. Accepting inserts the heading above the step whose
 * application changed; declining marks that step so the offer stops being made.
 */
function suggestionRow(hint, index) {
  const row = document.createElement('li');
  row.className = 'suggest';

  const why = document.createElement('span');
  why.className = 'why';
  why.textContent = `Moves to ${phaseName(hint.app)} here`;

  const add = document.createElement('button');
  add.className = 'tiny';
  add.textContent = '+ Section';
  add.title = 'Add a heading above this step';
  add.addEventListener('click', (e) => {
    e.stopPropagation();
    // Anchored to the row before, because insertion is "after" - which puts the
    // heading immediately above the step that changed application.
    //
    // Unnamed. The suggestion knows where a phase probably starts; it does not
    // know what that phase is called, and "Excel" is the name of a program
    // rather than of a piece of work.
    const before = steps[index - 1];
    addSection('', before && before.id);
  });

  const no = document.createElement('button');
  no.className = 'no';
  no.textContent = '\u00d7';
  no.title = 'Not a phase boundary';
  no.addEventListener('click', async (e) => {
    e.stopPropagation();
    const step = steps.find((x) => x.id === hint.id);
    if (!step) return;
    step.noSection = true;
    await window.bsr.updateStep(step.id, { noSection: true });
    renderList();
  });

  row.append(why, add, no);
  return row;
}

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

// Which marking tool is armed, if any: 'blur' | 'box' | 'arrow' | 'highlight'.
// A drag on the screenshot means something different for each, so exactly one
// is armed at a time and arming one disarms the rest.
let armedTool = null;

const TOOL_BUTTONS = () => ({
  blur: el.blur, box: el.box, ellipse: el.ellipse,
  arrow: el.arrow, highlight: el.highlight,
});

/** The highlighter colour in force, remembered between sessions. */
let highlightId = 'yellow';

function armTool(tool) {
  armedTool = armedTool === tool ? null : tool;
  for (const [name, button] of Object.entries(TOOL_BUTTONS())) {
    button.classList.toggle('active', armedTool === name);
  }
  el.wrap.classList.toggle('selecting', Boolean(armedTool));
  el.selection.hidden = true;
  el.dragPreview.hidden = true;
}

/**
 * Shows the mark that will be made, rather than the region dragged.
 *
 * A rectangle is right for a box, a highlight and a blur, and wrong for the
 * other two: dragging an arrow showed a box, which says nothing about which way
 * the arrow will point, and dragging a circle showed its bounding rectangle.
 */
function previewDrag(from, to) {
  const rectTools = armedTool === 'box' || armedTool === 'highlight'
                 || armedTool === 'blur';
  el.selection.hidden = !rectTools;
  el.dragPreview.hidden = rectTools;
  if (rectTools) return;

  const svg = 'http://www.w3.org/2000/svg';
  el.dragPreview.replaceChildren();

  if (armedTool === 'ellipse') {
    const e = document.createElementNS(svg, 'ellipse');
    e.setAttribute('cx', (from.x + to.x) / 2);
    e.setAttribute('cy', (from.y + to.y) / 2);
    e.setAttribute('rx', Math.abs(to.x - from.x) / 2);
    e.setAttribute('ry', Math.abs(to.y - from.y) / 2);
    e.setAttribute('fill', 'none');
    e.setAttribute('stroke', '#e5484d');
    e.setAttribute('stroke-width', '2');
    e.setAttribute('stroke-dasharray', '5 4');
    el.dragPreview.append(e);
    return;
  }

  // The arrow, drawn with the same geometry that will be burned in, so what is
  // previewed is what is produced.
  const g = BsrAnnotate.arrowGeometry(from, to, 3);
  const line = document.createElementNS(svg, 'line');
  line.setAttribute('x1', from.x); line.setAttribute('y1', from.y);
  line.setAttribute('x2', g.shaft.x); line.setAttribute('y2', g.shaft.y);
  line.setAttribute('stroke', '#e5484d');
  line.setAttribute('stroke-width', '3');
  line.setAttribute('stroke-linecap', 'round');

  const head = document.createElementNS(svg, 'polygon');
  head.setAttribute('points',
    `${to.x},${to.y} ${g.barbs[0].x},${g.barbs[0].y} ${g.barbs[1].x},${g.barbs[1].y}`);
  head.setAttribute('fill', '#e5484d');

  el.dragPreview.append(line, head);
}
let dragStart = null;

/**
 * Right-clicking the highlighter offers its colours. A guide that uses more
 * than one colour needs them chosen deliberately, and a menu on the tool is
 * where a person looks for that rather than in Settings.
 */
el.highlight.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  el.hueMenu.replaceChildren();

  for (const hue of BsrAnnotate.HIGHLIGHTS) {
    const b = document.createElement('button');
    b.type = 'button';
    if (hue.id === highlightId) b.className = 'chosen';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = hue.fill;

    const label = document.createElement('span');
    label.textContent = hue.name;

    b.append(swatch, label);
    b.addEventListener('click', async () => {
      highlightId = hue.id;
      el.hueMenu.hidden = true;
      await window.bsr.setSettings({ highlightColour: hue.id });
      // Choosing a colour is choosing to use it.
      if (armedTool !== 'highlight') armTool('highlight');
    });
    el.hueMenu.append(b);
  }

  el.hueMenu.style.left = `${e.clientX}px`;
  el.hueMenu.style.top = `${e.clientY}px`;
  el.hueMenu.hidden = false;
});

window.addEventListener('mousedown', (e) => {
  if (!el.hueMenu.hidden && !el.hueMenu.contains(e.target)) el.hueMenu.hidden = true;
});
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') el.hueMenu.hidden = true;
});

for (const name of ['blur', 'box', 'ellipse', 'arrow', 'highlight']) {
  el[name].addEventListener('click', () => armTool(name));
}

el.wrap.addEventListener('mousedown', (e) => {
  if (!armedTool || !selectedId) return;
  e.preventDefault();
  const r = el.shot.getBoundingClientRect();
  dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  previewDrag(dragStart, { x, y });
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
  const from = { x: dragStart.x, y: dragStart.y };
  const to = { x, y };
  dragStart = null;
  el.selection.hidden = true;
  el.dragPreview.hidden = true;

  // A box only needs the region; an arrow needs to know which end the reader
  // should be looking at, so the raw drag is kept as well.
  const rect = { x: sel.left, y: sel.top, w: sel.width, h: sel.height };
  if (!BsrAnnotate.isDeliberate(armedTool, rect, from, to)) return;

  await applyMark(armedTool, { sel, from, to }, r.width);
});

/**
 * Burns a mark into the screenshot.
 *
 * Blur and the annotation tools share everything except what is painted: read
 * the file, map the drag from displayed pixels to image pixels, draw, write
 * back with the original stashed for undo.
 */
async function applyMark(tool, { sel, from, to }, displayedWidth) {
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

  if (tool === 'blur') {
    // Pixelate first, then blur the pixelated block. Blur alone can leave
    // enough structure to read short text back; downsampling actually
    // discards it.
    const sw = Math.max(1, Math.round(w / 16));
    const sh = Math.max(1, Math.round(h / 16));
    const small = document.createElement('canvas');
    small.width = sw; small.height = sh;
    small.getContext('2d').drawImage(img, x, y, w, h, 0, 0, sw, sh);

    ctx.save();
    ctx.filter = 'blur(3px)';
    ctx.drawImage(small, 0, 0, sw, sh, x, y, w, h);
    ctx.restore();
  } else {
    BsrAnnotate.draw(ctx, tool, {
      rect: { x, y, w, h },
      from: { x: Math.round(from.x * ratio), y: Math.round(from.y * ratio) },
      to: { x: Math.round(to.x * ratio), y: Math.round(to.y * ratio) },
      width: img.naturalWidth,
      height: img.naturalHeight,
      highlight: BsrAnnotate.highlightFill(highlightId),
    });
  }

  const out = canvas.toDataURL('image/png');

  let r;
  try {
    r = await window.bsr.redactStep(step.id, out, tool,
                                    tool === 'highlight' ? highlightId : '');
  } catch (err) {
    showNotice(`Could not mark that area: ${err.message}`);
    return;
  }
  if (!r.ok) { alert(r.error); return; }

  steps[steps.indexOf(step)] = r.step;
  select(step.id);
}

// ---- export -------------------------------------------------------------------

el.exportBtn.addEventListener('click', async () => {
  if (!steps.length) { alert('Record something first.'); return; }
  if (!el.expTitle.value) el.expTitle.value = el.sessionName.value || 'Recorded steps';

  // Say what will happen to THIS recording, not what usually happens: an
  // evidence record is deliberately not rewritten into instructions.
  const s = await window.bsr.getSession();
  el.expNote.textContent = s.purpose === 'evidence'
    ? 'This is an evidence record, so wording stays in the past tense — "Clicked '
      + 'the Save button", describing what was done. Wording you edited yourself '
      + 'is left exactly as written.'
    : 'Descriptions are rewritten as instructions ("Click Save" rather than '
      + '"Clicked the Save button"). Wording you edited yourself is left exactly '
      + 'as written.';

  el.exportDlg.showModal();
});

el.expCancel.addEventListener('click', () => el.exportDlg.close());

el.expGo.addEventListener('click', async () => {
  el.exportDlg.close();
  // A large recording spends several seconds re-encoding screenshots before the
  // save dialog appears. Without this the window simply looks frozen.
  el.saveState.textContent = 'Exporting…';
  const r = await window.bsr.exportSteps(el.expFormat.value, el.expTitle.value);
  if (r.cancelled) { el.saveState.textContent = ''; return; }
  if (!r.ok) { alert(r.error); return; }
  el.saveState.textContent = `Exported to ${r.file}`;
  // The strip, not alert(). 20fe21c removed a modal for exactly this reason: a
  // routine outcome must not freeze the window. Being told the screenshots were
  // re-encoded is worth knowing and not worth a click to dismiss before
  // carrying on.
  if (r.warning) showNotice(r.warning);
});

// ---- settings ----------------------------------------------------------------

function paintSettings(v) {
  el.root.value = v.saveRoot;
  el.keyboard.checked = v.recordKeyboard !== false;
  el.brand.value = v.brandName || '';
  el.logo.value = v.brandLogo || '';
  el.footer.value = v.brandFooter || '';
  el.template.value = v.templatePath || '';
  paintTemplates(v.templatePath || '');
  highlightId = v.highlightColour || 'yellow';
  paintLegendMeanings(v);
  el.marker.value = v.markerStyle || 'circle';
  el.markerBold.checked = Boolean(v.markerBold);
  markerOpts = { style: el.marker.value, bold: el.markerBold.checked };
  el.format.value = v.imageFormat;
  el.quality.value = v.imageQuality;
  el.qualityVal.textContent = String(v.imageQuality);
  el.frame.value = v.imageFrame || 'window';
  el.scale.value = Math.round(v.imageScale * 100);
  el.scaleVal.textContent = `${Math.round(v.imageScale * 100)}%`;
  // Quality only means anything for a lossy format.
  el.qualityField.style.display = v.imageFormat === 'jpeg' ? 'flex' : 'none';
}

/**
 * Which build this is. The version number is not enough on its own - it stayed
 * at 0.1.0 across a day of changes - so the commit and the build time are shown
 * with it, and the capture engine separately, since the two halves are built
 * independently and a stale engine looks exactly like a fix that did not work.
 */
/** Base name of a path, on either separator. */
const baseName = (p) => (p || '').split(/[\\/]/).pop();

/**
 * Fills the template picker and names, in the export dropdown, the template
 * that would actually be used.
 *
 * The dropdown used to say "choose one in Settings" whenever nothing had been
 * chosen, which was untrue: a Word template ships with the app and is used when
 * nothing else is set. Saying otherwise sent people looking for a file they did
 * not need.
 */
async function paintTemplates(chosenPath) {
  let templates = [];
  let effective = { path: chosenPath, chosen: Boolean(chosenPath) };
  try {
    const r = await window.bsr.listTemplates();
    templates = (r && r.templates) || [];
    effective = await window.bsr.effectiveTemplate();
  } catch { /* leave the picker as it is rather than blanking it */ }

  if (el.templateList) {
    el.templateList.replaceChildren();
    for (const t of templates) {
      const o = document.createElement('option');
      o.value = t.path;
      o.textContent = t.origin === 'builtin' ? `${t.name} — ships with the app` : t.name;
      el.templateList.append(o);
    }
    // A file chosen with the browser may sit outside both folders.
    if (chosenPath && !templates.some((t) => t.path === chosenPath)) {
      const o = document.createElement('option');
      o.value = chosenPath;
      o.textContent = `${baseName(chosenPath)} — your own file`;
      el.templateList.append(o);
    }
    el.templateList.value = effective.path || '';
  }

  const name = baseName(effective.path);
  const mine = effective.chosen;
  el.optTemplate.textContent = !name
    ? 'Word, or your own template — none available'
    : /\.docx$/i.test(name)
      ? `Word (.docx) — into ${mine ? 'your template' : 'the built-in SOP template'}: ${name}`
      : `${mine ? 'Your own template' : 'The built-in template'} — ${name}`;
}

/**
 * A row per highlighter colour, for saying what it means in your guides.
 *
 * The meanings live in Settings rather than on a recording because they are an
 * organisation's convention - green means the same thing in every procedure it
 * writes, or it means nothing at all.
 */
function paintLegendMeanings(values) {
  el.legend.checked = Boolean(values.showHighlightLegend);
  el.legendMeanings.hidden = !el.legend.checked;
  el.legendMeanings.replaceChildren();

  const meanings = values.highlightMeanings || {};
  for (const hue of BsrAnnotate.HIGHLIGHTS) {
    const row = document.createElement('div');
    row.className = 'row';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = hue.fill;

    const label = document.createElement('label');
    label.textContent = hue.name;
    label.htmlFor = `mean-${hue.id}`;

    const input = document.createElement('input');
    input.type = 'text';
    input.id = `mean-${hue.id}`;
    input.value = meanings[hue.id] || '';
    input.placeholder = 'what this colour means';
    input.addEventListener('change', async () => {
      const next = { ...(values.highlightMeanings || {}), [hue.id]: input.value.trim() };
      await window.bsr.setSettings({ highlightMeanings: next });
      values.highlightMeanings = next;
    });

    row.append(swatch, label, input);
    el.legendMeanings.append(row);
  }
}

el.legend.addEventListener('change', async () => {
  const v = await window.bsr.setSettings({ showHighlightLegend: el.legend.checked });
  paintLegendMeanings(v);
});

async function paintBuild() {
  let b;
  try { b = await window.bsr.getBuild(); } catch { return; }
  if (!b) return;

  // The commit identifies the build on its own; the build time and the engine's
  // were noise beside it. In a package the engine ships inside the installer and
  // cannot be out of step, so there is nothing to say about it - and when there
  // IS, it is said below rather than left for the reader to work out by
  // comparing two timestamps.
  el.build.textContent = `Build ${b.build} · ${b.version} · ${b.commit}`;

  if (b.source !== 'packaged') el.build.append(' · development');

  if (b.engineStale) {
    const warn = document.createElement('span');
    warn.className = 'stale';
    // Says what to do, not what was compared. The check is the engine against
    // its own source, so the app being newer is not the point.
    warn.textContent = ' — capture engine needs rebuilding';
    el.build.append(warn);
  }
}

el.settingsBtn.addEventListener('click', async () => {
  paintSettings(await window.bsr.getSettings());
  paintBuild();
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

for (const control of ['marker', 'markerBold']) {
  el[control].addEventListener('change', async () => {
    markerOpts = { style: el.marker.value, bold: el.markerBold.checked };
    await window.bsr.setSettings({
      markerStyle: el.marker.value, markerBold: el.markerBold.checked,
    });
    // Redraw the step on screen, so the choice can be seen rather than imagined.
    const step = steps.find((x) => x.id === selectedId);
    if (step && step.point) placeIndicator(step);
  });
}

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

el.templatePick.addEventListener('click', async () => {
  const r = await window.bsr.chooseTemplate();
  if (!r.ok) { if (r.error) alert(r.error); return; }
  paintSettings(r.values);

  // Say what the template declares, so a typo in a hook name is visible now
  // rather than as a gap in a finished document.
  const i = r.inspection || {};
  const bits = [`${(i.hooks || []).length} hooks`];
  if ((i.loops || []).length) bits.push(`${i.loops.length} repeating block(s)`);
  if ((i.unpaired || []).length) bits.push(`unpaired: ${i.unpaired.join(', ')}`);
  el.templateInfo.textContent = bits.join(' · ');
});

// Taking a stock template and making it yours, in one step: the app copies it
// somewhere you own, starts using it, and opens it so you can start editing.
el.templateCopy.addEventListener('click', async () => {
  const r = await window.bsr.duplicateTemplate(el.templateList.value);
  if (!r.ok) { showNotice(r.error); return; }

  paintSettings(r.values);
  showNotice(r.opened
    ? `Copied to your templates folder and opened for editing. It is now the `
      + `template exports use. Keep the {{…}} markers — that is where the `
      + `recording goes.`
    : `Copied to ${r.path}, and it is now the template exports use. Open it `
      + `yourself to edit — this machine had nothing registered to open it.`);
});

el.templateFolder.addEventListener('click', () => window.bsr.revealTemplates());

el.templateList.addEventListener('change', async () => {
  paintSettings(await window.bsr.setSettings({ templatePath: el.templateList.value }));
});

el.templateClear.addEventListener('click', async () => {
  paintSettings(await window.bsr.setSettings({ templatePath: '' }));
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
refreshShortcuts();
renderLibrary();
window.bsr.getScope().then((s) => {
  scopeChoice = s;
  el.scopeBtn.textContent = `Capture: ${s.label}`;
});
