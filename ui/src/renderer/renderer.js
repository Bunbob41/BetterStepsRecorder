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
  blur: $('btn-blur'), crop: $('btn-crop'),
  wrap: $('shot-wrap'), selection: $('selection'),
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
  library: $('btn-library'),
  libraryQuery: $('library-query'), libraryFound: $('library-found'),
  context: $('context'),
  libraryHeading: $('library-heading'), libraryUsage: $('library-usage'),
  rootUsage: $('set-root-usage'),
  findBar: $('findbar'), findQuery: $('find-query'),
  findReplacement: $('find-replacement'), findCase: $('find-case'),
  findWord: $('find-word'), findCount: $('find-count'),
  findGo: $('find-go'), findClose: $('find-close'),
  exclude: $('chk-exclude'), frame: $('set-frame'),
  sessionName: $('session-name'), libraryList: $('library-list'),
  libraryEmpty: $('library-empty'),
  compactBar: $('compactbar'), cDot: $('c-dot'), cState: $('c-state'),
  cCount: $('c-count'), cPause: $('c-pause'), cStop: $('c-stop'),
  cElapsed: $('c-elapsed'),
  build: $('build'),
  marker: $('set-marker'), markerBold: $('set-marker-bold'),
  showMarker: $('set-show-marker'),
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

  const matching = matchingIds();

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
      + (matching.has(s.id) ? ' matched' : '')
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
      : [BsrAppName.friendly(s.window?.process, s.window?.product),
         s.action, s.excluded ? 'excluded' : null]
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

  showPane('step');
  el.text.value = step.text || '';
  el.exclude.checked = !!step.excluded;

  const isSection = BsrSections.isSection(step);
  const isNote = step.action === 'note' || isSection;
  // A written step has no screenshot, so the tools that act on one are moot.
  for (const t of ['blur', 'crop', 'box', 'ellipse', 'arrow', 'highlight']) {
    el[t].hidden = isNote;
  }
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
let markerOpts = { style: 'circle', bold: false, show: true };

/**
 * Where the marker belongs, as a percentage of the picture.
 *
 * A position the author dragged wins over the recorded one. The engine anchors
 * a typed step at the CENTRE of the focused control, because it has no way to
 * know where the caret is - so on a wide search box the marker lands in the
 * middle of the box rather than where the words went. That is a limitation to
 * be corrected by hand, not a defect in the engine.
 *
 * The same order as `markerPosition` in the exporter, so what is dragged here
 * is what the document shows.
 */
function markerPos(step) {
  // The same function the exporters use, so what is previewed is what is
  // produced - including the decision not to draw one at all.
  return BsrMarker.positionFor(step, markerOpts);
}


function placeIndicator(step) {
  if (!el.shot.naturalWidth) return;
  const pos = markerPos(step);
  if (!pos) {
    // No marker for this step: hidden, turned off everywhere, or a picture
    // with none placed on it. The overlay has to be EMPTIED, not left showing
    // the last one drawn - selecting a step clears it first, so returning
    // early was harmless until something could take a marker away in place.
    el.indicator.replaceChildren();
    el.indicator.style.display = 'none';
    el.indicator.classList.remove('moved', 'movable');
    return;
  }

  // render(), not html(): a style attribute would be refused by the content
  // policy this window runs under, and the marker would sit at 0,0 unstyled.
  el.indicator.replaceChildren(
    BsrMarker.render({ x: pos.x, y: pos.y }, markerOpts, '#e5484d'));
  el.indicator.classList.toggle('moved', pos.moved);
  // Grabbable only when no drawing tool is armed, so one drag cannot mean two
  // things depending on where it started.
  el.indicator.classList.toggle('movable', !armedTool);
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
  // "start/pause", because the same key does both depending on whether
  // anything is recording - and the start half is the one nobody knew about.
  el.hotkeyHint.append(' start/pause');
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

/** Stops listening, whatever the reason, and puts the global hotkeys back. */
async function stopListening() {
  if (!listeningFor) return;
  const { row, btn, label } = listeningFor;
  row.classList.remove('listening');
  btn.textContent = label;
  listeningFor = null;
  await window.bsr.captureKeys(false);
  await refreshShortcuts();
}

for (const btn of document.querySelectorAll('.k-set')) {
  btn.addEventListener('click', async () => {
    const row = btn.closest('.keyrow');
    listeningFor = { which: btn.dataset.which, row, btn, label: btn.textContent };
    row.classList.add('listening');
    btn.textContent = 'Press keys\u2026';
    row.querySelector('.k-keys').textContent = 'press a combination, or Esc to cancel';
    el.kError.hidden = true;
    // The application's own hotkeys are taken at the operating system, ahead
    // of this window - so until they are released, the chord being replaced
    // cannot be typed into the box that replaces it.
    await window.bsr.captureKeys(true);
  });
}

// However the dialog is dismissed - Done, Escape, or the window - the hotkeys
// have to come back. Listening is the only state in this application that is
// unsafe to leave behind.
el.keysDlg.addEventListener('close', () => { stopListening(); });

// Captured at the window, ahead of the app's own key handling, so binding to
// something like Ctrl+Z does not also undo an edit on the way past.
window.addEventListener('keydown', async (e) => {
  if (!listeningFor) return;
  e.preventDefault();
  e.stopPropagation();

  if (e.key === 'Escape') { await stopListening(); return; }

  const chosen = acceleratorFrom(e);
  if (chosen === null) return;       // a lone modifier: keep waiting

  // A key that cannot be part of a global hotkey used to be indistinguishable
  // from one that never arrived: the row went on saying "Press keys..." with
  // no reason given, which reads as the dialog being broken.
  if (chosen.error) {
    el.kError.textContent = chosen.error;
    el.kError.hidden = false;
    return;                          // still listening: try another one
  }

  const { which } = listeningFor;
  const accelerator = chosen.accelerator;
  await stopListening();

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

/** Arrow and navigation keys, as the operating system names them. */
const NAMED_KEYS = {
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  Insert: 'Insert', Delete: 'Delete', Backspace: 'Backspace',
  Tab: 'Tab', Enter: 'Enter',
};

/**
 * Mirrors the rule in the main process: a bare letter would swallow that key
 * across the whole machine, so a modifier is required unless it is a function key.
 */
function acceleratorFrom(e) {
  // Null means "keep waiting"; an { error } means "that one cannot be used,
  // and here is why". The two used to be the same answer.
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(e.key)) return null;

  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');

  let main = '';
  if (/^F\d{1,2}$/.test(e.key)) main = e.key;
  else if (e.key === ' ' || e.code === 'Space') main = 'Space';
  else if (NAMED_KEYS[e.key]) main = NAMED_KEYS[e.key];
  else if (e.key.length === 1) main = e.key.toUpperCase();
  else return { error: `${e.key} cannot be part of a global shortcut. `
                     + 'Try a letter, a number or a function key.' };

  if (!mods.length && !/^F\d{1,2}$/.test(main)) {
    return { error: 'That needs a modifier — Ctrl, Alt or Shift — '
                  + 'or a function key on its own.' };
  }
  return { accelerator: [...mods, main].join('+') };
}

window.bsr.onHotkeys(paintShortcuts);

// ---- advisory notices ----------------------------------------------------------
// Shown after a recording ends, dismissed by the user, and never modal.

/**
 * The strip under the toolbar.
 *
 * `settings` decides whether the link to Settings comes with it. The strip was
 * written for one message - the one about screenshot size, which is only
 * actionable in Settings - and offering that link beside "Replaced 3
 * occurrences" points the reader at a page that has nothing to do with what
 * just happened.
 */
function showNotice(message, { settings = false } = {}) {
  el.noticeText.textContent = message;
  el.noticeSettings.hidden = !settings;
  el.notice.hidden = false;
}

// The engine's notices are about capture settings, which is where the link
// earns its place.
window.bsr.onNotice(({ message }) => showNotice(message, { settings: true }));

el.noticeClose.addEventListener('click', () => { el.notice.hidden = true; });

el.noticeSettings.addEventListener('click', () => {
  el.notice.hidden = true;
  // The notice this link belongs to is about screenshot size, so it opens on
  // the tab that can do something about it rather than wherever you were last.
  openSettings('screenshots');
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
  recordingBegan(r);
});

/**
 * What the window shows once a recording is under way.
 *
 * Shared with the hotkey, which starts one without this dialog ever opening.
 * Two copies of this would drift, and the half that drifted would leave the
 * window claiming to be idle while the engine was recording.
 */
function recordingBegan(r) {
  steps = [];
  selectedId = null;
  marked.clear();
  el.sessionName.value = r.name || '';
  el.scopeBtn.textContent = `Capture: ${r.scope}`;
  el.notice.hidden = true;
  // Starting a recording while a step was open left the PREVIOUS recording's
  // screenshot and details sitting in the pane, under a step list that had
  // just been emptied.
  showPane('library');
  renderList();
  setState('recording');
  startElapsed();
}

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
  openDir = r.dir;
  el.reveal.disabled = false;
  steps = r.steps;
  selectedId = null;
  showPane('library');
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
  showPane('library');
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

  // Ctrl+F wherever you are, including inside the find fields themselves, so
  // pressing it twice re-selects the query rather than doing nothing.
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    openFind();
    return;
  }

  if (e.key === 'Escape' && !el.findBar.hidden) {
    e.preventDefault();
    closeFind();
    return;
  }

  // Ctrl+Shift+Z as well as Ctrl+Y: both are redo depending on where somebody
  // learned the habit, and there is no reason to have an opinion about it.
  const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z';
  const isRedo = (e.ctrlKey || e.metaKey)
    && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'));

  if ((isUndo || isRedo) && !typing) {
    e.preventDefault();
    await (isRedo ? redoOnce() : undoOnce());
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
function savedState(count, dir) {
  openDir = dir;
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
}

window.bsr.onSaved(({ dir, count }) => savedState(count, dir));

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

/** The recording currently open, so the library can point at it. */
let openDir = null;

/**
 * Which of the two things the right-hand pane is showing.
 *
 * It has always had two states and, until now, no way out of one of them.
 * Opening a recording replaced the library with a step, and after a search
 * that meant the results were gone as well - the one case where getting back
 * matters most, because the query is the work.
 *
 * The single owner of both flags, so the two cannot end up both hidden, and
 * of the button, which greys out when it would do nothing.
 */
function showPane(which) {
  const home = which === 'library';
  el.detailEmpty.hidden = !home;
  el.detailBody.hidden = home;
  el.library.disabled = home;
}

/**
 * Back to the recordings.
 *
 * The recording stays open and the selected step stays selected - this shows
 * the library, it does not close anything. So the step list is the way back
 * in: the row you were on is still highlighted, and clicking it returns you.
 *
 * The query is deliberately left in the box and re-run, because arriving back
 * at "Recent recordings" after searching for something is the same dead end
 * from the other direction.
 */
async function showLibrary() {
  showPane('library');
  await renderLibrary();
}

el.library.addEventListener('click', showLibrary);

/**
 * Opens a recording, and lands on a particular step when one is named.
 *
 * `at` is what makes a search result a way in rather than a filter: finding the
 * recording is half the job, and the other half is not then scrolling forty
 * steps looking for the line you searched for.
 */
async function openRecording(dir, at = null) {
  const res = await window.bsr.openLibrary(dir);
  if (!res.ok) { showNotice(res.error); renderLibrary(); return false; }

  steps = res.steps;
  selectedId = null;
  // Ids are GUIDs, so a leftover selection cannot match a step in the recording
  // being opened - but it is still counted, and the button would offer to
  // "Delete 3 steps" that are not there and then delete nothing.
  marked.clear();
  el.sessionName.value = res.name || '';
  // Saying it here too. The tick only appeared while recording, so editing an
  // existing recording gave no sign that every change was already on disk -
  // which is the moment somebody is most likely to look for a Save button and
  // worry when there is not one.
  savedState(res.steps.length, res.dir);
  el.reveal.disabled = false;
  renderList();

  const wanted = at && steps.some((s) => s.id === at) ? at
               : steps.length ? steps[0].id : null;
  if (wanted) {
    await select(wanted);
    const row = el.list.querySelector(`li[data-id="${CSS.escape(wanted)}"]`);
    if (row) row.scrollIntoView({ block: 'center' });
  }
  return true;
}

/**
 * The matched words picked out of a line.
 *
 * Built as nodes rather than markup: the text is whatever was recorded from
 * somebody's screen, and putting that through innerHTML would be handing a
 * window title the ability to write elements.
 */
function highlighted(text, query) {
  const frag = document.createDocumentFragment();
  const source = String(text == null ? '' : text);
  const re = BsrFind.pattern(query, findOptionsFor(query));
  if (!re) { frag.append(source); return frag; }

  let last = 0;
  for (const m of source.matchAll(re)) {
    if (m.index > last) frag.append(source.slice(last, m.index));
    const mark = document.createElement('mark');
    mark.textContent = m[0];
    frag.append(mark);
    last = m.index + m[0].length;
  }
  frag.append(source.slice(last));
  return frag;
}

/** The archive search is always plain and case-insensitive; the find bar owns
 *  the options, and borrowing them here would make one box change the other. */
const findOptionsFor = () => ({ caseSensitive: false, wholeWord: false });

/** One row on the library screen, for a recent recording or a search result. */
function libraryRow(r, query) {
  const row = document.createElement('div');
  // Marked when it is the one already open, so coming back from a recording
  // lands somewhere recognisable rather than in a list of similar cards.
  row.className = 'lib-row' + (r.inName ? ' hit-name' : '')
                            + (r.unreadable ? ' unreadable' : '')
                            + (openDir && r.dir === openDir ? ' current' : '');
  // Listed, but marked. Hiding a recording this version cannot open would look
  // exactly like having lost it.
  if (r.unreadable) row.title = r.unreadable;

  const name = document.createElement('div');
  name.className = 'lib-name';
  const label = r.name || 'Untitled recording';
  if (query) name.append(highlighted(label, query));
  else name.textContent = label;

  // The application, not the date: a recording named by default already
  // carries its timestamp, and printing it twice reads as a mistake.
  const meta = document.createElement('div');
  meta.className = 'lib-meta';
  // The reason comes with the row. Hard-coding one here said "made by a newer
  // version" over a recording that was simply damaged - the listing was right,
  // the refusal was right, and the words under it were wrong.
  meta.textContent = r.unreadable
    ? (r.unreadableLabel || 'Cannot be opened here')
    : (r.app || 'No application recorded');

  const count = document.createElement('div');
  count.className = 'lib-count';
  const n = document.createElement('div');
  n.textContent = `${r.steps} step${r.steps === 1 ? '' : 's'}`;
  const when = document.createElement('div');
  when.className = 'lib-when';
  when.textContent = r.savedAt ? new Date(r.savedAt).toLocaleString() : '';

  // What this one costs. A single recording of anything animated can be most
  // of a folder, and without this the only way to find it is Explorer.
  const size = document.createElement('div');
  size.className = 'lib-size';
  size.textContent = r.bytes ? BsrBytes.human(r.bytes) : '';

  count.append(n, size, when);

  row.append(name, meta, count);
  row.addEventListener('click', () => openRecording(r.dir));

  // The lines that matched, so a recording can be recognised without opening
  // it, and each one opens the recording at that step.
  if (query && r.hits && r.hits.length) {
    const list = document.createElement('ul');
    list.className = 'lib-hits';
    for (const hit of r.hits) {
      const li = document.createElement('li');
      li.className = 'lib-hit';
      const num = document.createElement('span');
      num.className = 'n';
      num.textContent = String(hit.index + 1);
      const text = document.createElement('span');
      text.append(highlighted(hit.text, query));
      li.append(num, text);
      li.addEventListener('click', (e) => {
        e.stopPropagation();
        openRecording(r.dir, hit.id);
      });
      list.append(li);
    }
    if (r.more) {
      const more = document.createElement('li');
      more.className = 'lib-more';
      more.textContent = `and ${r.more} more in this recording`;
      list.append(more);
    }
    row.append(list);
  }

  return row;
}

/**
 * What the recordings folder holds, and the fact that it fills itself.
 *
 * Both halves are transparency. There is no Save button, which is only
 * reassuring if somebody can see that saving is happening; and screenshots
 * stack up faster than anybody expects, which is only actionable if somebody
 * can see the total before a disk fills rather than after.
 */
async function paintUsage() {
  const u = await window.bsr.libraryUsage();
  if (!u || !u.ok) { el.libraryUsage.textContent = ''; return; }

  el.libraryUsage.replaceChildren();
  el.libraryUsage.append('Recordings save as you go to ');

  const path = document.createElement('span');
  path.className = 'path';
  path.textContent = u.root;
  el.libraryUsage.append(path);

  const size = document.createElement('span');
  // Amber past a gigabyte. Not a warning - just the point at which somebody
  // would want to know without having gone looking.
  if (u.bytes >= 1024 * 1024 * 1024) size.className = 'heavy';
  size.textContent = ` \u2014 ${u.recordings} recording${u.recordings === 1 ? '' : 's'}, `
                   + BsrBytes.human(u.bytes);
  el.libraryUsage.append(size);

  // Settings says the same thing beside the folder it is about.
  if (el.rootUsage) {
    const held = u.recordings
      ? `Currently ${u.recordings} recording${u.recordings === 1 ? '' : 's'}, `
        + `${BsrBytes.human(u.bytes)}. `
      : 'No recordings yet. ';
    el.rootUsage.textContent = held
      + 'Recordings save as you go, so there is no Save button - there is '
      + 'nothing to save.';
  }
}

let librarySearchAt = 0;

async function renderLibrary() {
  const query = el.libraryQuery.value.trim();

  // Each search is stamped, and a reply that is not the newest is dropped:
  // typing quickly starts several reads of the folder and they can finish in
  // any order, which without this leaves the results of an earlier, shorter
  // query on screen.
  const stamp = ++librarySearchAt;

  if (!query) {
    const rows = await window.bsr.listLibrary();
    if (stamp !== librarySearchAt) return;
    paintUsage();
    el.libraryHeading.textContent = 'Recent recordings';
    el.libraryFound.textContent = '';
    el.libraryList.replaceChildren();
    el.libraryEmpty.hidden = rows.length > 0;
    for (const r of rows.slice(0, 12)) el.libraryList.append(libraryRow(r, ''));
    return;
  }

  const res = await window.bsr.searchLibrary(query);
  if (stamp !== librarySearchAt) return;
  if (!res || !res.ok) { showNotice((res && res.error) || 'Could not search.'); return; }

  const results = res.results || [];
  // The heading was still saying "Recent recordings" over a list of search
  // results, which is a small lie the eye notices before the mind does.
  el.libraryHeading.textContent = 'Recordings matching your search';
  el.libraryFound.textContent = results.length
    ? `${results.length} recording${results.length === 1 ? '' : 's'}`
    : 'nothing found';
  el.libraryEmpty.hidden = true;
  el.libraryList.replaceChildren();
  for (const r of results) el.libraryList.append(libraryRow(r, query));
}

let librarySearchTimer = null;
el.libraryQuery.addEventListener('input', () => {
  // A search reads every recording on disk; doing that per keystroke is
  // wasteful for an answer nobody has finished asking for.
  clearTimeout(librarySearchTimer);
  librarySearchTimer = setTimeout(renderLibrary, 150);
});

el.libraryQuery.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && el.libraryQuery.value) {
    e.stopPropagation();
    el.libraryQuery.value = '';
    renderLibrary();
  }
});

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

/**
 * One step back, or one forward.
 *
 * Shared by the keyboard and the menu so the two cannot come to disagree, and
 * because a redo that only worked from one of them would be a strange thing to
 * discover.
 */
async function stepHistory(direction) {
  const r = direction === 'redo' ? await window.bsr.redo() : await window.bsr.undo();
  if (!r || r.empty) return;
  if (!r.ok) {
    // The strip, not a dialog: an undo that cannot be applied is worth saying
    // and not worth a click to dismiss.
    showNotice(r.error || `Nothing to ${direction}.`);
    return;
  }
  steps = r.steps;
  renderList();
  if (selectedId && steps.some((s) => s.id === selectedId)) select(selectedId);
}

const undoOnce = () => stepHistory('undo');
const redoOnce = () => stepHistory('redo');

// ---- moving the click marker --------------------------------------------------
// Dragged on the picture rather than typed as numbers: the whole question is
// "not there, there", and the answer is a place on a screenshot.

let markerDrag = null;

/** Sends a new position, or `null` to put it back where it was recorded. */
async function commitMarker(id, at) {
  const step = steps.find((s) => s.id === id);
  const r = await window.bsr.moveMarker(id, at);

  if (!r || !r.ok) {
    showNotice((r && r.error) || 'Could not move the marker.');
    if (step) placeIndicator(step);        // undo the live preview
    return;
  }
  if (step) {
    Object.assign(step, r.step);
    // The field is dropped rather than set to null when it is reset, and
    // Object.assign cannot remove a key, so it is removed by hand.
    if (!r.step.markerAt) delete step.markerAt;
    placeIndicator(step);
  }
}

/** Hides or shows the marker on one step. */
async function hideMarker(id, hidden) {
  const step = steps.find((s) => s.id === id);
  const r = await window.bsr.hideMarker(id, hidden);
  if (!r || !r.ok) {
    showNotice((r && r.error) || 'Could not change the marker.');
    return;
  }
  if (step) {
    Object.assign(step, r.step);
    if (!r.step.markerHidden) delete step.markerHidden;
    placeIndicator(step);
  }
}

el.indicator.addEventListener('mousedown', (e) => {
  if (e.button !== 0 || armedTool || !selectedId) return;
  if (!e.target.closest('.bsr-marker')) return;

  // No stopPropagation: the menus close on a window-level mousedown, and
  // swallowing it here would leave one open behind the drag.
  e.preventDefault();
  const rect = el.shot.getBoundingClientRect();
  markerDrag = { id: selectedId, rect, from: { x: e.clientX, y: e.clientY },
                 at: null, moved: false };
});

window.addEventListener('mousemove', (e) => {
  if (!markerDrag) return;
  const r = markerDrag.rect;
  const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
  const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
  markerDrag.at = { x, y };

  // A few pixels of slip while clicking is not a move. Without this every
  // click on the marker would write a step and fill the undo history.
  if (Math.abs(e.clientX - markerDrag.from.x) > 2
   || Math.abs(e.clientY - markerDrag.from.y) > 2) markerDrag.moved = true;

  el.indicator.replaceChildren(BsrMarker.render({ x, y }, markerOpts, '#e5484d'));
});

window.addEventListener('mouseup', async () => {
  const drag = markerDrag;
  markerDrag = null;
  if (!drag) return;

  if (!drag.moved || !drag.at) {
    // Put it back: the live redraw may have nudged it by a pixel.
    const step = steps.find((s) => s.id === drag.id);
    if (step) placeIndicator(step);
    return;
  }
  await commitMarker(drag.id, drag.at);
});

// ---- the right-click menu -----------------------------------------------------
// One element, filled differently depending on what was right-clicked. Two
// menus would be two things to keep in step, and the highlighter menu already
// showed the shape.

function closeContext() { el.context.hidden = true; el.context.replaceChildren(); }

/**
 * Shows a menu at a point.
 *
 * `items` are `{ label, key, run, enabled }`, or `null` for a divider. Built as
 * elements rather than markup: the labels include step wording, which came off
 * somebody's screen, and putting that through innerHTML would let a window
 * title write elements.
 */
function showContext(x, y, items) {
  el.hueMenu.hidden = true;    // two menus open at once is one too many
  el.context.replaceChildren();

  for (const item of items) {
    if (!item) {
      el.context.append(document.createElement('hr'));
      continue;
    }

    const button = document.createElement('button');
    const label = document.createElement('span');
    label.textContent = item.label;
    button.append(label);

    if (item.key) {
      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = item.key;
      button.append(key);
    }

    button.disabled = item.enabled === false;
    button.addEventListener('click', () => { closeContext(); item.run(); });
    el.context.append(button);
  }

  // Placed, then nudged back on screen: a menu opened near the right or bottom
  // edge would otherwise run off it.
  el.context.hidden = false;
  el.context.style.left = `${x}px`;
  el.context.style.top = `${y}px`;
  const box = el.context.getBoundingClientRect();
  if (box.right > window.innerWidth) {
    el.context.style.left = `${Math.max(0, window.innerWidth - box.width - 4)}px`;
  }
  if (box.bottom > window.innerHeight) {
    el.context.style.top = `${Math.max(0, window.innerHeight - box.height - 4)}px`;
  }
}

/** The two that belong on every menu, because they always apply. */
const historyItems = () => [
  { label: 'Undo', key: 'Ctrl+Z', enabled: historyDepth.undo > 0,
    run: () => undoOnce() },
  { label: 'Redo', key: 'Ctrl+Y', enabled: historyDepth.redo > 0,
    run: () => redoOnce() },
];

/**
 * Right-clicking a step.
 *
 * The row is selected first unless it is already part of the selection, which
 * is how every list in Windows behaves - otherwise "Delete step" on the menu
 * and "Delete step" on the toolbar would act on different steps.
 */
el.list.addEventListener('contextmenu', (e) => {
  const row = e.target.closest('li.step');
  if (!row) return;
  e.preventDefault();

  const id = row.dataset.id;
  if (!marked.has(id)) { marked = new Set([id]); select(id); }

  const step = steps.find((s) => s.id === id);
  if (!step) return;
  const many = marked.size > 1;

  showContext(e.clientX, e.clientY, [
    ...historyItems(),
    null,
    { label: 'Add a note below', run: () => el.note.click() },
    { label: 'Add a section heading', run: () => addSection('', id) },
    null,
    { label: step.excluded ? 'Include in the guide' : 'Leave out of the guide',
      run: () => setExcluded([...marked], !step.excluded) },
    { label: many ? `Delete ${marked.size} steps` : 'Delete step', key: 'Del',
      run: () => deleteSelection() },
  ]);
});

/** Takes a set of steps in or out of the guide in one go. */
async function setExcluded(ids, excluded) {
  for (const id of ids) {
    const step = steps.find((s) => s.id === id);
    if (!step) continue;
    step.excluded = excluded;
    await window.bsr.updateStep(id, { excluded });
  }
  if (selectedId && ids.includes(selectedId)) el.exclude.checked = excluded;
  renderList();
}

/**
 * Right-clicking the screenshot.
 *
 * Undo and redo, and the one thing that is only reachable here: putting a
 * marker that has been dragged back where the recording put it.
 */
el.wrap.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  const step = steps.find((s) => s.id === selectedId);
  const moved = Boolean(step && step.markerAt);

  const hidden = Boolean(step && step.markerHidden);

  showContext(e.clientX, e.clientY, [
    ...historyItems(),
    null,
    { label: hidden ? 'Show the marker on this step'
                    : 'Hide the marker on this step',
      enabled: Boolean(step),
      run: () => hideMarker(step.id, !hidden) },
    { label: 'Put the marker back where it was recorded',
      enabled: moved,
      run: () => commitMarker(step.id, null) },
  ]);
});

window.addEventListener('mousedown', (e) => {
  if (!el.context.hidden && !el.context.contains(e.target)) closeContext();
});
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeContext(); });
window.addEventListener('blur', closeContext);

// ---- find and replace ---------------------------------------------------------
// A guide is written once and read for years. A system gets renamed, a team
// changes, a button's label changes - and without this the choice is retyping
// forty steps or letting the guide go stale, which in practice means stale.

const findOptions = () =>
  ({ caseSensitive: el.findCase.checked, wholeWord: el.findWord.checked });

/** The rows the current query matches, for marking them in the list. */
function matchingIds() {
  if (el.findBar.hidden) return new Set();
  const q = el.findQuery.value;
  if (!q) return new Set();
  return new Set(BsrFind.matches(steps, q, findOptions()).map((m) => m.id));
}

/** The running count under the query, so Replace all is never a guess. */
function paintFindCount() {
  const q = el.findQuery.value;
  if (!q) { el.findCount.textContent = ''; el.findGo.disabled = true; return; }

  const hits = BsrFind.matches(steps, q, findOptions());
  const rows = hits.length;
  const total = hits.reduce((n, h) => n + h.count, 0);
  el.findCount.textContent = rows
    ? `${total} in ${rows} step${rows === 1 ? '' : 's'}`
    : 'none';
  el.findGo.disabled = rows === 0;
}

function openFind() {
  el.findBar.hidden = false;
  el.findQuery.focus();
  el.findQuery.select();
  paintFindCount();
  renderList();
}

function closeFind() {
  el.findBar.hidden = true;
  renderList();          // clears the match marks
}

for (const node of [el.findQuery, el.findCase, el.findWord]) {
  node.addEventListener('input', () => { paintFindCount(); renderList(); });
  node.addEventListener('change', () => { paintFindCount(); renderList(); });
}

el.findClose.addEventListener('click', closeFind);

el.findGo.addEventListener('click', async () => {
  const q = el.findQuery.value;
  if (!q) return;

  const r = await window.bsr.replaceAll(q, el.findReplacement.value, findOptions());
  if (!r || !r.ok) { alert((r && r.error) || 'Could not replace.'); return; }

  if (r.steps) steps = r.steps;
  renderList();
  // The selected step's text may have changed under the detail pane.
  if (selectedId && steps.some((s) => s.id === selectedId)) select(selectedId);
  paintFindCount();
  // Only when there is something to say: an empty strip is a notice that the
  // user has to dismiss and learns nothing from.
  if (r.message) showNotice(r.message);
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
let historyDepth = { undo: 0, redo: 0 };

window.bsr.onUndoDepth((depth) => {
  historyDepth = { undo: depth.undo || 0, redo: depth.redo || 0 };
  el.del.textContent = marked.size > 1 ? `Delete ${marked.size} steps` : 'Delete step';
  el.del.title = historyDepth.undo
    ? `${historyDepth.undo} change${historyDepth.undo === 1 ? '' : 's'} can be undone (Ctrl+Z)`
    : '';
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

window.bsr.onHotkey(({ action, session, error }) => {
  if (action === 'paused') setState('paused');
  else if (action === 'resumed') setState('recording');
  else if (action === 'stopped') setState('idle');
  else if (action === 'started' && session) {
    recordingBegan(session);
    showNotice(`Recording ${session.scope}. Press the same key to pause, `
             + 'and the stop key to finish.');
  } else if (action === 'idle') {
    // The report that started this: a hotkey that does nothing is
    // indistinguishable from a hotkey that is not working.
    showNotice('Nothing is being recorded. Press the pause key, or Start '
             + 'recording, to begin one.');
  } else if (action === 'failed') {
    showNotice(error || 'Could not start recording.');
  }
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
  el.indicator.classList.toggle('movable', !armedTool);
  el.selection.hidden = true;
  showPreview(false);
}

/**
 * Shows or hides the preview overlay.
 *
 * By attribute, not by `.hidden`. That property belongs to HTMLElement, and the
 * overlay is an <svg> - so `el.dragPreview.hidden = false` quietly defined a
 * plain JavaScript property, left the `hidden` attribute the stylesheet matches
 * on exactly where it was, and then read back as `false` as though it had
 * worked. The preview was correct, present in the DOM, and invisible.
 */
function showPreview(on) {
  el.dragPreview.toggleAttribute('hidden', !on);
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
                 || armedTool === 'blur' || armedTool === 'crop';
  // The single owner of which of the two is on screen. Nothing else may set
  // these: the version that shipped had the mousedown handler re-showing the
  // rectangle straight afterwards, so a circle drag previewed a box.
  el.selection.hidden = !rectTools;
  // Crop keeps what is inside the rectangle; every other rectangle tool acts
  // on it. The selection is drawn inverted so the two cannot be confused.
  el.selection.classList.toggle('cropping', armedTool === 'crop');
  showPreview(!rectTools);
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

for (const name of ['blur', 'crop', 'box', 'ellipse', 'arrow', 'highlight']) {
  el[name].addEventListener('click', () => armTool(name));
}

el.wrap.addEventListener('mousedown', (e) => {
  if (!armedTool || !selectedId) return;
  e.preventDefault();
  const r = el.shot.getBoundingClientRect();
  dragStart = { x: e.clientX - r.left, y: e.clientY - r.top };
  Object.assign(el.selection.style, { left: `${dragStart.x}px`, top: `${dragStart.y}px`,
                                      width: '0px', height: '0px' });
  // From the start point to itself: nothing to see yet, but it puts the right
  // one of the two on screen before the pointer moves.
  previewDrag(dragStart, dragStart);
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

  // The whole point of the preview: redrawn as the pointer moves. Without this
  // the circle and the arrow were drawn once, at zero size, and never again.
  previewDrag(dragStart, { x, y });
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
  showPreview(false);

  // A box only needs the region; an arrow needs to know which end the reader
  // should be looking at, so the raw drag is kept as well.
  const rect = { x: sel.left, y: sel.top, w: sel.width, h: sel.height };
  // `sel`, not `rect`: applyCrop works in the displayed box's own terms. And
  // `r.width` from up there, measured with the drag - not re-measured later,
  // which is a different number if anything reflowed in between.
  if (armedTool === 'crop') { await applyCrop(sel, r.width); return; }

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
/**
 * Trims the screenshot to the dragged region.
 *
 * Separate from applyMark because it is not a mark: it changes the size of the
 * picture, which is the one edit the click marker's position depends on. The
 * main process cuts the step's `frame` by the same proportion, and the marker
 * - a percentage of that frame - goes on pointing at the same thing.
 */
async function applyCrop(sel, displayedWidth) {
  const step = steps.find((s) => s.id === selectedId);
  if (!step) return;

  const dataUrl = await window.bsr.shotData(step.screenshot);
  if (!dataUrl) { showNotice('Could not read the screenshot.'); return; }

  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve; img.onerror = reject; img.src = dataUrl;
  });

  // Measured when the drag ended, not now. Reading it here would ask the
  // element how wide it is AFTER two awaits, and a window resized or a notice
  // strip appearing in between changes the answer - scaling a selection taken
  // at the old width by the new one, and cropping to the wrong region.
  const ratio = img.naturalWidth / displayedWidth;
  const image = { width: img.naturalWidth, height: img.naturalHeight };
  const rect = BsrCrop.clamp({
    x: sel.left * ratio, y: sel.top * ratio,
    w: sel.width * ratio, h: sel.height * ratio,
  }, image);

  if (!BsrCrop.isDeliberate(rect, image)) return;

  // Said before it happens, not discovered in the finished document. Cropping
  // the click out is a legitimate thing to want - trimming to a panel the
  // click was not in - but it should never be a surprise.
  // The marker the step actually shows, which is the dragged one where there
  // is one. Asking about the recorded click would warn about the wrong thing.
  if (BsrCrop.losesAnyMarker(step, rect, image)) {
    const ok = confirm('The marker on this step is outside that region, so the '
      + 'step will have no marker on it. Crop anyway?');
    if (!ok) return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  canvas.getContext('2d')
    .drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  const r = await window.bsr.cropStep(step.id, canvas.toDataURL('image/png'),
                                      rect, image);
  if (!r || !r.ok) { showNotice((r && r.error) || 'Could not crop that step.'); return; }

  steps[steps.indexOf(step)] = r.step;
  armTool('crop');       // one crop at a time, so the next drag is deliberate
  select(step.id);
}

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
  // With the link: what it warns about - screenshots too large to embed - is
  // changed in Settings, under capture format.
  if (r.warning) showNotice(r.warning, { settings: true });
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
  // Absent means shown, matching the settings file: somebody upgrading expects
  // the marker they have always had.
  el.showMarker.checked = v.showClickMarker !== false;
  markerOpts = { style: el.marker.value, bold: el.markerBold.checked,
                 show: el.showMarker.checked };
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

/**
 * The tab last looked at.
 *
 * Kept for the session rather than written to the settings file: somebody who
 * is in Exports is usually in Exports several times in a row, and reopening on
 * Recording each time is the scrolling this replaced, one dialog later.
 */
let settingsTab = 'recording';

function showTab(name) {
  settingsTab = name;
  for (const b of document.querySelectorAll('#settings-tabs .tab')) {
    b.setAttribute('aria-selected', String(b.dataset.tab === name));
  }
  for (const p of document.querySelectorAll('#settings .tabpanel')) {
    p.toggleAttribute('hidden', p.id !== `tab-${name}`);
  }
}

for (const b of document.querySelectorAll('#settings-tabs .tab')) {
  b.addEventListener('click', () => showTab(b.dataset.tab));
}

// Left and right along the strip, which is how a tab list is expected to
// behave and costs almost nothing.
document.getElementById('settings-tabs').addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
  if (!step) return;
  e.preventDefault();
  const tabs = [...document.querySelectorAll('#settings-tabs .tab')];
  const at = tabs.findIndex((b) => b.dataset.tab === settingsTab);
  const next = tabs[(at + step + tabs.length) % tabs.length];
  showTab(next.dataset.tab);
  next.focus();
});

/** One way in, so the two things that open Settings cannot drift apart. */
async function openSettings(tab = settingsTab) {
  paintSettings(await window.bsr.getSettings());
  paintBuild();
  showTab(tab);
  el.dialog.showModal();
}

el.settingsBtn.addEventListener('click', () => openSettings());

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

for (const control of ['marker', 'markerBold', 'showMarker']) {
  el[control].addEventListener('change', async () => {
    markerOpts = { style: el.marker.value, bold: el.markerBold.checked,
                   show: el.showMarker.checked };
    await window.bsr.setSettings({
      markerStyle: el.marker.value, markerBold: el.markerBold.checked,
      showClickMarker: el.showMarker.checked,
    });
    // Redraw the step on screen, so the choice can be seen rather than imagined.
    const step = steps.find((x) => x.id === selectedId);
    if (step) placeIndicator(step);
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
