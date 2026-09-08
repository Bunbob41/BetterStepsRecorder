/**
 * The real page, exercised in a real window: the drag preview, and finding and
 * replacing across a recording.
 *
 * This tier exists because of a bug that shipped twice without anything
 * noticing. `previewDrag` was called as `previewDrag(dragStart, { x, y })` from
 * a scope where `x` and `y` do not exist: a ReferenceError on every mousedown,
 * which killed the rest of the handler, so no tool previewed anything at all -
 * not the circle, not the arrow, not even the rubber band a box and a blur
 * have always had. Every unit test passed, because none of them runs a
 * handler. The static wiring test passed, because every element and channel it
 * checks really does exist.
 *
 * Underneath that was a second one only a rendered page could show. The
 * overlay is an <svg>, and `.hidden` is a property of HTMLElement - so
 * `el.dragPreview.hidden = false` defined a plain JavaScript property, left
 * the `hidden` attribute the stylesheet matches on exactly where it was, and
 * read back as `false` as though it had worked. A DOM assertion was fooled by
 * it in the same way the code was.
 *
 * So: the real index.html, the real renderer.js and the real stylesheet, in a
 * real Electron window, with the bridge stubbed by a preload the way the
 * application stubs nothing. Mouse events are dispatched INTO THE PAGE. No
 * input is synthesized at the operating system, and nothing outside this
 * window is touched.
 *
 *   npx electron tests/window_test.js
 */
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'ui', 'src', 'renderer');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

/** Everything the page asks the main process for, answered plausibly. */
const PRELOAD = `
const { contextBridge } = require('electron');

const shot = {
  point: { x: 300, y: 200 }, frame: { x: 0, y: 0, w: 600, h: 400 },
  window: { title: 'App', process: 'app.exe', rect: { x: 0, y: 0, w: 600, h: 400 } },
  screenshot: 'steps/0001.png',
};

const SESSION = {
  ok: true, dir: 'C:/fake/session-1', name: 'Window test',
  steps: [
    { id: 's1', action: 'leftClick', text: 'Click the "New" button', ...shot },
    // Its own editedAt so its screenshot URL differs from every other step's.
    // The page cache-busts with ?v=<editedAt>, and an <img> assigned the src it
    // already has fires no load event - so with identical URLs, selecting this
    // step would never run placeIndicator and there would be no marker to drag.
    { id: 's2', action: 'leftClick', text: 'Click Save, then Save again',
      editedAt: '2026-01-01T00:00:00.000Z', ...shot },
    { id: 'n1', action: 'note', text: 'Save first', textEdited: true },
    { id: 's3', action: 'leftClick', text: 'Click Cancel', ...shot },
  ],
};

// The real handler lives in main.js; here it only has to be faithful enough
// that the page's own behaviour - the count, the marks, the notice - is what
// is under test.
const find = require(PROJECT + '/ui/src/renderer/find.js');
const crop = require(PROJECT + '/ui/src/renderer/crop.js');
const { solidPngDataUrl } = require(PROJECT + '/tests/png-fixture.js');
const SHOT = solidPngDataUrl(600, 400);

// The page is told the depth over an event, and the menu greys Undo and Redo
// by it - so a stub that never fires leaves both permanently disabled and the
// menu untestable.
let depthListener = () => {};
let DEPTH = { undo: 0, redo: 0 };
let LAST_MARKER = null;
const CALLED = [];

const chords = require(PROJECT + '/ui/src/main/shortcuts.js');
const KEYS = {
  values: { hotkeyPause: '', hotkeyStop: '' },
  calls: [],
  captured: [],
  state() {
    const r = chords.resolve(this.values);
    return { pause: r.pause, stop: r.stop, pauseActive: true, stopActive: true,
             defaults: chords.DEFAULTS };
  },
};

const ANSWERS = {
  // Every key the page reads, with the names the real settings file uses.
  // A half-answered stub painted "undefined" into the save path, "NaN%" into
  // the scale and nothing into the format list - which is indistinguishable,
  // in a screenshot, from the page being broken.
  getSettings: () => ({
    saveRoot: 'C:\\Users\\You\\Documents\\StepRecordings',
    imageFormat: 'png', imageQuality: 85, imageScale: 1, imageFrame: 'window',
    recordKeyboard: true,
    markerStyle: 'circle', markerBold: false,
    highlightColour: 'yellow', showHighlightLegend: false, highlightMeanings: {},
    brandName: '', brandLogo: '', brandFooter: '', templatePath: '',
  }),
  getShortcuts: () => KEYS.state(),
  // The real one releases the global hotkeys, so the chord being replaced can
  // actually be typed into the box that replaces it.
  captureKeys: (on) => { KEYS.captured.push(on); return { ok: true }; },
  // Mirrors the real handler closely enough that the PAGE is what is under
  // test: validate, refuse a clash, otherwise keep it and report the new state.
  setShortcut: (which, accelerator) => {
    KEYS.calls.push({ which, accelerator });
    const key = which === 'stop' ? 'hotkeyStop' : 'hotkeyPause';
    if (!accelerator) { KEYS.values[key] = ''; return { ok: true, state: KEYS.state() }; }
    if (!chords.isValid(accelerator)) {
      return { ok: false, error: 'That needs a modifier.' };
    }
    const resolved = chords.resolve(KEYS.values);
    if (accelerator === (which === 'stop' ? resolved.pause : resolved.stop)) {
      return { ok: false, error: 'Pause and stop cannot share a shortcut.' };
    }
    KEYS.values[key] = accelerator;
    return { ok: true, state: KEYS.state() };
  },
  getScope: () => ({ pids: [], label: 'Everything' }),
  getSession: () => SESSION,
  openLibrary: () => SESSION,
  listLibrary: () => [{ dir: SESSION.dir, name: 'Preview test', steps: 1, savedAt: null }],
  // The real handler runs archive.search over the folder; here it only has to
  // be faithful enough that the page's own behaviour is what is under test.
  searchLibrary: (query) => {
    if (String(query).toLowerCase() !== 'save') return { ok: true, results: [] };
    return { ok: true, results: [{
      dir: SESSION.dir, name: 'Preview test', app: 'app.exe', steps: 3,
      savedAt: null, total: 3, inName: false, more: 2,
      hits: [{ id: 's2', index: 1, count: 2, text: 'Click Save, then Save again' },
             { id: 'n1', index: 2, count: 1, text: 'Save first' }],
    }] };
  },
  // Answered properly rather than left to the generic { ok: true }: the line
  // it paints reads "undefined recordings, 0 B" without this, which is exactly
  // the kind of thing a screenshot is taken to catch.
  libraryUsage: () => ({ ok: true, root: 'C:/fake', recordings: 1, bytes: 4_200_000 }),
  listTemplates: () => ({ templates: [] }),
  effectiveTemplate: () => ({ name: '' }),
  getBuild: () => ({ version: '0.1.0', build: 71, commit: 'test', source: 'dev' }),
  // A 1x1 transparent GIF: the screenshot never has to decode, because every
  // measurement the drag makes comes from the <img> element's box, which the
  // test sizes explicitly.
  // bsr://, as the application serves it, and not a data: URL. The page
  // cache-busts by appending "?v=<editedAt>", and a query on a data: URL
  // becomes part of the base64 - the image then never decodes, naturalWidth
  // stays 0, and placeIndicator quietly places nothing. Every drag test still
  // passed, because a drag measures the <img> element's box rather than the
  // picture inside it. A file: URL is no better: this page's policy is
  // img-src bsr: data:, and refuses one.
  shotUrl: (rel) => 'bsr://step/' + encodeURIComponent(String(rel || 'shot.png')),
  // A real image at a real size. Returning null here sent every completed drag
  // into alert('Could not read the screenshot.') - a modal that never resolves
  // in a hidden window, and a run that never ended. It also meant the marking
  // path was never actually reached.
  shotData: () => SHOT,
  updateStep: () => ({ ok: true }),
  // Enough of the real handler that the PAGE's behaviour is what is under
  // test: the real one clamps, pushes an undo entry and writes the field.
  // history.js is exercised on its own; this is about the drag.
  moveMarker: (id, at) => {
    const step = SESSION.steps.find((x) => x.id === id);
    if (!step) return { ok: false, error: 'Step not found.' };
    if (at) step.markerAt = { x: at.x, y: at.y };
    else delete step.markerAt;
    LAST_MARKER = { id, at: at ? { ...at } : null };
    DEPTH = { undo: DEPTH.undo + 1, redo: 0 };
    depthListener(DEPTH);
    return { ok: true, step };
  },
  undo: () => { CALLED.push('undo'); return { ok: true, steps: SESSION.steps }; },
  redo: () => { CALLED.push('redo'); return { ok: true, steps: SESSION.steps }; },
  // The page assigns r.step back into its list, so a stub that omits it puts
  // undefined where a step should be and the next render dies.
  redactStep: (id) => ({ ok: true, step: SESSION.steps.find((x) => x.id === id) }),
  cropStep: (id, dataUrl, rect, image) => {
    const step = SESSION.steps.find((x) => x.id === id);
    if (!step) return { ok: false, error: 'gone' };
    // What the real handler does: the frame is cut with the picture.
    const next = crop.frameAfter(step.frame, rect, image);
    if (next) step.frame = next;
    step.cropped = true;
    LAST_CROP = { id, rect, frame: next, bytes: (dataUrl || '').length };
    return { ok: true, step };
  },
  replaceAll: (query, replacement, options) => {
    const changes = find.plan(SESSION.steps, query, replacement, options || {});
    for (const c of changes) {
      const step = SESSION.steps.find((x) => x.id === c.id);
      if (step) step.text = c.text;
    }
    return { ok: true, changes: changes.length, message: find.describe(changes),
             steps: SESSION.steps };
  },
};

// A plain object, built from the names the real preload exposes. contextBridge
// refuses a Proxy ("An object could not be cloned"), and taking the names from
// preload.js rather than a list here means the stub cannot drift away from the
// surface the page actually has.
let LAST_CROP = null;

const bridge = {};
for (const name of NAMES) {
  bridge[name] = name.startsWith('on')
    ? () => {}
    : async (...args) => (ANSWERS[name] ? ANSWERS[name](...args) : { ok: true });
}
bridge.__lastCrop = async () => LAST_CROP;
bridge.__keys = async () =>
  ({ values: KEYS.values, calls: KEYS.calls, captured: KEYS.captured });
bridge.__lastMarker = async () => LAST_MARKER;
bridge.__called = async () => CALLED;
bridge.onUndoDepth = (fn) => { depthListener = fn; };
// Redo is only reachable once something has been undone, and nothing in this
// window has a real history - so the depth is set directly to open the door.
bridge.__setDepth = async (d) => { DEPTH = d; depthListener(DEPTH); };
contextBridge.exposeInMainWorld('bsr', bridge);
`;

/** The methods the real bridge offers, read from the real preload. */
function bridgeNames() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'ui', 'src', 'main', 'preload.js'), 'utf8');
  const names = [...src.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
  if (names.length < 20) throw new Error('preload surface not recognised');
  return names;
}

/**
 * Arms a tool, presses, moves, and reports what the page is actually showing.
 * Returns after the move, with the drag still open.
 */
const DRAG = (tool, dx, dy) => `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const wrap = document.getElementById('shot-wrap');
  const shot = document.getElementById('shot');
  const sel = document.getElementById('selection');
  const preview = document.getElementById('drag-preview');
  const r = shot.getBoundingClientRect();

  document.getElementById('btn-${tool}').click();
  await sleep(20);
  wrap.dispatchEvent(new MouseEvent('mousedown',
    { bubbles: true, clientX: r.left + 40, clientY: r.top + 40 }));
  await sleep(15);
  window.dispatchEvent(new MouseEvent('mousemove',
    { bubbles: true, clientX: r.left + 40 + ${dx}, clientY: r.top + 40 + ${dy} }));
  await sleep(15);

  const shape = preview.firstElementChild;
  const box = preview.getBoundingClientRect();
  const out = {
    // Visibility read from the DOM, never from the .hidden property: on an
    // <svg> that property is a lie.
    rubberBandShown: !sel.hasAttribute('hidden'),
    previewShown: !preview.hasAttribute('hidden'),
    // A preview nobody can see is the failure this test exists for.
    previewHasArea: box.width > 0 && box.height > 0,
    shapes: [...preview.children].map((c) => c.tagName).join('+'),
    shapeBox: shape ? { w: Math.round(shape.getBoundingClientRect().width),
                        h: Math.round(shape.getBoundingClientRect().height) } : null,
    rubberBox: { w: Math.round(sel.getBoundingClientRect().width),
                 h: Math.round(sel.getBoundingClientRect().height) },
  };

  window.dispatchEvent(new MouseEvent('mouseup',
    { bubbles: true, clientX: r.left + 40 + ${dx}, clientY: r.top + 40 + ${dy} }));
  await sleep(60);
  document.getElementById('btn-${tool}').click();   // disarm
  await sleep(20);
  out.clearedAfterRelease = preview.hasAttribute('hidden') && sel.hasAttribute('hidden');
  return out;
})()`;

// A run that never settles must not sit there holding the machine. Electron
// shows a modal dialog for an uncaught main-process error, and on a hidden
// window that dialog is invisible and waits forever.
const consoleLog = [];

const watchdog = setTimeout(() => {
  console.log('\nTIMED OUT - the run never reached the end');
  // Without this a hang is a dead end: the page is hidden, so its errors are
  // the only account of what happened.
  if (consoleLog.length) {
    console.log('the page said:');
    for (const line of consoleLog.slice(-12)) console.log('    ' + line);
  }
  app.exit(2);
}, 45000);

app.whenReady().then(async () => {
  // Its own directory, with its own package.json beside it.
  //
  // The preload used to be written straight into the system temp folder, and
  // Node resolves a module by walking UP looking for a package.json - so an
  // unrelated program that had dropped a malformed one in there made Electron
  // refuse to load this preload at all, and the page came up with no bridge.
  // Declaring the module type here stops the walk at the first step and makes
  // the test independent of whatever else is in temp.
  const preloadDir = path.join(os.tmpdir(), `bsr-window-test-${Date.now()}`);
  fs.mkdirSync(preloadDir, { recursive: true });
  fs.writeFileSync(path.join(preloadDir, 'package.json'), '{"type":"commonjs"}');

  const preloadPath = path.join(preloadDir, 'preload.js');
  fs.writeFileSync(preloadPath,
    `const NAMES = ${JSON.stringify(bridgeNames())};\n`
    + `const PROJECT = ${JSON.stringify(path.join(__dirname, '..').replace(/\\/g, '/'))};\n`
    + PRELOAD);

  // The same scheme the application registers, answered with one real 600x400
  // picture. Registered here rather than stubbed in the preload because the
  // page's content policy is what decides whether an image loads at all.
  const { solidPng } = require('./png-fixture.js');
  protocol.handle('bsr', () => new Response(solidPng(600, 400),
    { headers: { 'content-type': 'image/png' } }));

  const win = new BrowserWindow({
    // Hidden for a normal run. Shown when a capture is asked for, because a
    // hidden window's compositor does not necessarily produce a fresh frame -
    // capturePage on one returned a picture of a moment that had already
    // passed, which is worse than no picture at all.
    //
    // A shown window can also lose focus to whatever else is running, and the
    // page closes its menus on blur - correctly. So a BSR_SHOTS run can fail
    // the right-click checks for reasons that have nothing to do with the
    // code. Trust a hidden run for pass/fail; use a shown one to look.
    width: 1280, height: 900, show: Boolean(process.env.BSR_SHOTS),
    // Matched to the application's own window, sandbox included: the default
    // is sandboxed, where a preload cannot require anything but electron - so
    // the stub failed to load and the page came up with no bridge at all.
    webPreferences: {
      preload: preloadPath, contextIsolation: true,
      nodeIntegration: false, sandbox: false,
    },
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
    consoleLog.push(`[${level}] ${message}`);
    if (level >= 2) errors.push(message);
  });

  await win.loadFile(path.join(RENDERER, 'index.html'));

  // Open the recording the way a person does, then select its step, so the
  // handlers run against the state they run against in the application.
  await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The screenshot is a 1x1 placeholder; give it the size a real one has,
    // since every coordinate in the drag comes from this element's box.
    //
    // Through the CSSOM, not an injected <style>: this page's own policy is
    // style-src 'self', which refuses a stylesheet added at runtime. A test
    // that worked around the policy would not be testing this page.
    const shotEl = document.getElementById('shot');
    shotEl.style.width = '600px';
    shotEl.style.height = '400px';

    // A modal dialog in a window nobody can see waits forever, and that is how
    // this run hung. Recording them instead both keeps the run finite and
    // turns "the page gave up and told the user" into something assertable.
    window.__alerts = [];
    window.alert = (m) => { window.__alerts.push(String(m)); };
    // confirm() blocks a hidden window exactly as alert() does. Recorded, and
    // answered "yes", so a run never stalls on a question nobody can see.
    window.__confirms = [];
    window.confirm = (m) => { window.__confirms.push(String(m)); return true; };
    // The page boots asynchronously - the library is fetched over the bridge -
    // so wait for the row rather than assuming it is there.
    const until = async (sel) => {
      for (let i = 0; i < 100; i++) {
        const node = document.querySelector(sel);
        if (node) return node;
        await sleep(20);
      }
      throw new Error('never appeared: ' + sel);
    };

    (await until('.lib-row')).click();
    (await until('#step-list li.step')).click();
    await sleep(150);
    return true;
  })()`);

  console.log('a drag shows the mark that will be made:');

  const ellipse = await win.webContents.executeJavaScript(DRAG('ellipse', 200, 120));
  check('a circle previews a circle', ellipse.shapes === 'ellipse');
  check('and not the rectangle dragged', !ellipse.rubberBandShown);
  check('it is on screen, not merely in the document', ellipse.previewShown);
  check('and the overlay it is drawn on has a size',
        ellipse.previewHasArea);
  // Guarded, so a run against code that draws nothing reports every failure
  // rather than throwing on the first missing shape.
  check('the shape follows the pointer rather than staying where it started',
        Boolean(ellipse.shapeBox)
        && ellipse.shapeBox.w === 200 && ellipse.shapeBox.h === 120);

  const arrow = await win.webContents.executeJavaScript(DRAG('arrow', 240, -30));
  check('an arrow previews a shaft and a head', arrow.shapes === 'line+polygon');
  check('and not the rectangle dragged', !arrow.rubberBandShown);
  check('drawn where it can be seen', arrow.previewShown && arrow.previewHasArea);

  for (const tool of ['box', 'highlight', 'blur']) {
    const r = await win.webContents.executeJavaScript(DRAG(tool, 220, 160));
    check(`${tool} shows the region being dragged`, r.rubberBandShown);
    check(`  sized to the drag`, r.rubberBox.w === 220 && r.rubberBox.h === 160);
    check(`  and no shape overlay`, !r.previewShown);
  }

  console.log('\nand nothing is left behind:');
  check('releasing clears both', ellipse.clearedAfterRelease && arrow.clearedAfterRelease);

  // ---- find and replace ----------------------------------------------------
  console.log('\nfinding and replacing across the recording:');

  const find1 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const bar = document.getElementById('findbar');
    const q = document.getElementById('find-query');

    // Ctrl+F is the only way in, so it is part of what is being tested.
    document.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'f', ctrlKey: true, bubbles: true }));
    await sleep(60);
    const opened = !bar.hidden;

    q.value = 'Save';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(80);

    const marked = [...document.querySelectorAll('#step-list li.matched')]
      .map((li) => li.dataset.id);

    return {
      opened,
      focused: document.activeElement === q,
      count: document.getElementById('find-count').textContent,
      marked,
      canReplace: !document.getElementById('find-go').disabled,
    };
  })()`);

  check('Ctrl+F opens it', find1.opened);
  check('with the cursor already in the query', find1.focused);
  // Three occurrences: two in one step, one in a note. The count has to be of
  // occurrences AND rows, or Replace all is a guess.
  check('the count is occurrences and rows', find1.count === '3 in 2 steps');
  check('matching rows are marked in the list', find1.marked.join() === 's2,n1');
  check('a note is searched, because a reader sees it',
        find1.marked.includes('n1'));
  check('and rows that do not match are not marked', !find1.marked.includes('s3'));
  check('Replace all is offered', find1.canReplace);

  const find2 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('find-query').value = 'nowhere-at-all';
    document.getElementById('find-query').dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(60);
    return { count: document.getElementById('find-count').textContent,
             disabled: document.getElementById('find-go').disabled,
             marked: document.querySelectorAll('#step-list li.matched').length };
  })()`);

  check('a query that matches nothing says so', find2.count === 'none');
  check('and Replace all is refused rather than doing nothing', find2.disabled);
  check('with no rows marked', find2.marked === 0);

  const find3 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = document.getElementById('find-query');
    q.value = 'Save';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('find-replacement').value = 'Store';
    await sleep(60);
    document.getElementById('find-go').click();
    await sleep(200);

    const titles = [...document.querySelectorAll('#step-list li.step .title')]
      .map((t) => t.textContent);
    return {
      titles,
      notice: (document.getElementById('notice-text') || {}).textContent || '',
      countNow: document.getElementById('find-count').textContent,
    };
  })()`);

  check('every occurrence is replaced, including two in one step',
        find3.titles.some((t) => t === 'Click Store, then Store again'));
  check('and in a note', find3.titles.some((t) => t === 'Store first'));
  check('rows that did not match are untouched',
        find3.titles.some((t) => t === 'Click Cancel'));
  check('the author is told what happened',
        /Replaced 3 occurrences in 2 steps/.test(find3.notice));
  check('and the count reflects the new text', find3.countNow === 'none');

  const find4 = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(60);
    return { hidden: document.getElementById('findbar').hidden,
             marked: document.querySelectorAll('#step-list li.matched').length };
  })()`);

  check('Escape closes it', find4.hidden);
  check('and the marks go with it', find4.marked === 0);

  // ---- cropping ------------------------------------------------------------
  console.log('\ntrimming a screenshot to what matters:');

  const cropped = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const sel = document.getElementById('selection');
    const r = shot.getBoundingClientRect();

    document.querySelector('#step-list li.step').click();
    await sleep(120);

    document.getElementById('btn-crop').click();
    await sleep(30);
    wrap.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, clientX: r.left + 100, clientY: r.top + 80 }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: r.left + 400, clientY: r.top + 300 }));
    await sleep(15);
    const inverted = sel.classList.contains('cropping');
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, clientX: r.left + 400, clientY: r.top + 300 }));
    await sleep(250);

    return { inverted, last: await window.bsr.__lastCrop(),
             confirms: window.__confirms.length };
  })()`);

  check('the selection reads as keep-this, not act-on-this', cropped.inverted);
  check('a crop reaches the main process', Boolean(cropped.last));
  check('with a region inside the picture',
        cropped.last.rect.x >= 0 && cropped.last.rect.y >= 0
        && cropped.last.rect.w > 0 && cropped.last.rect.h > 0);
  check('and the pixels to write', cropped.last.bytes > 100);
  // The whole reason crop needed care: the frame goes with the picture.
  check('the frame is cut with it', Boolean(cropped.last.frame));
  check('and it is smaller than it was',
        cropped.last.frame.w < 600 && cropped.last.frame.h < 400);
  // The click on this fixture is at 300,200 of a 600x400 frame - inside the
  // region dragged - so nothing should have been asked.
  check('a crop that keeps the click asks nothing', cropped.confirms === 0);

  // ---- moving the click marker ---------------------------------------------
  // The engine anchors a typed step at the centre of the focused control, so on
  // a wide box the marker lands in the middle of it rather than where the words
  // went. Dragging it is the correction, and it has to be VISIBLE - the marker
  // is drawn through the CSSOM under a policy that refuses style attributes,
  // which is exactly the kind of thing that fails silently.

  console.log('\nmoving the click marker:');

  const marker = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const ind = document.getElementById('indicator');

    // s2, not the first step: the crop above cut that one's frame.
    document.querySelector('#step-list li[data-id="s2"]').click();
    await sleep(250);

    const r = shot.getBoundingClientRect();
    const mark = ind.querySelector('.bsr-marker');
    const at = (node) => {
      const b = node.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2 - r.left),
               y: Math.round(b.top + b.height / 2 - r.top),
               w: Math.round(b.width), h: Math.round(b.height) };
    };

    const before = mark ? at(mark) : null;
    const shown = Boolean(mark) && ind.style.display === 'block';
    if (!mark) return { shown, before, why: {
      display: ind.style.display, kids: ind.childElementCount,
      natural: shot.naturalWidth, src: shot.src.slice(0, 60),
      selected: (document.querySelector('#step-list li.selected') || {}).dataset,
    } };

    // Grab it and put it a quarter of the way in from the left.
    mark.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0, clientX: r.left + 300, clientY: r.top + 200 }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: r.left + 150, clientY: r.top + 100 }));
    await sleep(15);
    const during = at(ind.querySelector('.bsr-marker'));
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, clientX: r.left + 150, clientY: r.top + 100 }));
    await sleep(200);

    const after = at(ind.querySelector('.bsr-marker'));
    return {
      shown, before, during, after,
      movable: ind.classList.contains('movable'),
      moved: ind.classList.contains('moved'),
      sent: await window.bsr.__lastMarker(),
    };
  })()`);

  if (marker.why) console.log('    why:', JSON.stringify(marker.why));
  check('the recorded click is marked on the picture',
        marker.shown && Boolean(marker.before));
  check('where the click was, not at the corner',
        Boolean(marker.before) && Math.abs(marker.before.x - 300) <= 2
        && Math.abs(marker.before.y - 200) <= 2);
  check('and the mark has a size somebody can see',
        Boolean(marker.before) && marker.before.w > 8 && marker.before.h > 8);
  check('it can be picked up', marker.movable);
  check('it follows the pointer while dragged',
        Math.abs(marker.during.x - 150) <= 2 && Math.abs(marker.during.y - 100) <= 2);
  check('the new place reaches the main process', Boolean(marker.sent));
  // 150 of 600 and 100 of 400: a percentage of the frame, like everywhere else,
  // so a later crop and every export follow without knowing this happened.
  check('as a percentage of the picture, not pixels',
        Boolean(marker.sent) && Math.abs(marker.sent.at.x - 25) < 1
        && Math.abs(marker.sent.at.y - 25) < 1);
  check('and it stays there after the write',
        Math.abs(marker.after.x - 150) <= 2 && Math.abs(marker.after.y - 100) <= 2);
  check('a moved marker says so', marker.moved);

  const nudge = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const mark = document.querySelector('#indicator .bsr-marker');
    const r = shot.getBoundingClientRect();
    const beforeCount = (await window.bsr.__called()).length;

    mark.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0, clientX: r.left + 150, clientY: r.top + 100 }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: r.left + 151, clientY: r.top + 100 }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, clientX: r.left + 151, clientY: r.top + 100 }));
    await sleep(150);

    const b = document.querySelector('#indicator .bsr-marker').getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2 - r.left),
             sent: await window.bsr.__lastMarker() };
  })()`);

  // A pixel of slip while clicking is not a move, and treating it as one would
  // fill the undo history with edits nobody made.
  check('a click that does not move it writes nothing',
        Math.abs(nudge.sent.at.x - 25) < 1);
  check('and leaves it exactly where it was', Math.abs(nudge.x - 150) <= 2);

  const armed = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('btn-blur').click();
    await sleep(30);
    const off = !document.getElementById('indicator').classList.contains('movable');
    document.getElementById('btn-blur').click();   // disarm
    await sleep(30);
    return { off, backOn: document.getElementById('indicator').classList.contains('movable') };
  })()`);

  // One drag cannot mean two things depending on where it started.
  check('arming a tool takes the marker out of play', armed.off);
  check('and disarming gives it back', armed.backOn);

  // ---- the right-click menus -----------------------------------------------
  console.log('\nright-clicking:');

  const shotMenu = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const r = shot.getBoundingClientRect();
    await window.bsr.__setDepth({ undo: 2, redo: 1 });
    await sleep(30);

    document.getElementById('shot-wrap').dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 150 }));
    await sleep(60);

    const menu = document.getElementById('context');
    const items = [...menu.querySelectorAll('button')]
      .map((b) => ({ label: b.textContent, disabled: b.disabled }));
    const box = menu.getBoundingClientRect();
    // A menu with no background is a menu drawn over the screenshot, and a
    // measurement cannot tell the difference. The stylesheet is what makes it
    // readable, so read back what the page actually resolved.
    const style = getComputedStyle(menu);
    const first = getComputedStyle(menu.querySelector('button'));
    return { shown: !menu.hidden, onScreen: box.width > 0 && box.height > 0,
             inside: box.right <= window.innerWidth && box.bottom <= window.innerHeight,
             opaque: !/transparent|rgba\(0, 0, 0, 0\)/.test(style.backgroundColor),
             ink: first.color, paper: style.backgroundColor,
             items };
  })()`);

  // Geometry is not appearance. Every one of the bugs this file exists for -
  // the collapsed arrowhead, the invisible highlight, the invisible drag
  // preview - passed a measurement and failed the eye, so: BSR_SHOTS=<dir>
  // writes what the window is actually showing.
  if (process.env.BSR_SHOTS) {
    const image = await win.webContents.capturePage();
    const out = path.join(process.env.BSR_SHOTS, 'context-menu.png');
    fs.writeFileSync(out, image.toPNG());
    console.log('    wrote ' + out);
  }

  check('the menu opens on the picture', shotMenu.shown && shotMenu.onScreen);
  check('and stays on screen', shotMenu.inside);
  check('with a background, rather than floating over the screenshot',
        shotMenu.opaque);
  check('and text that is not the background colour',
        shotMenu.ink !== shotMenu.paper);
  check('it offers undo and redo',
        /Undo/.test(shotMenu.items[0].label) && /Redo/.test(shotMenu.items[1].label));
  check('both live, because there is something to go back to',
        !shotMenu.items[0].disabled && !shotMenu.items[1].disabled);
  check('and the one thing only reachable here',
        shotMenu.items.some((i) => /marker back/.test(i.label) && !i.disabled));

  const reset = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const r = shot.getBoundingClientRect();
    [...document.querySelectorAll('#context button')]
      .find((b) => /marker back/.test(b.textContent)).click();
    await sleep(250);

    const b = document.querySelector('#indicator .bsr-marker').getBoundingClientRect();
    return {
      closed: document.getElementById('context').hidden,
      sent: await window.bsr.__lastMarker(),
      x: Math.round(b.left + b.width / 2 - r.left),
      y: Math.round(b.top + b.height / 2 - r.top),
      moved: document.getElementById('indicator').classList.contains('moved'),
    };
  })()`);

  check('choosing an item closes the menu', reset.closed);
  check('putting it back sends nothing rather than a position',
        reset.sent.at === null);
  check('and the marker returns to where the recording put it',
        Math.abs(reset.x - 300) <= 2 && Math.abs(reset.y - 200) <= 2);
  check('and stops calling itself moved', !reset.moved);

  const rowMenu = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const row = document.querySelector('#step-list li[data-id="s3"]');
    const b = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: b.left + 20, clientY: b.top + 8 }));
    await sleep(120);

    const items = [...document.querySelectorAll('#context button')]
      .map((x) => x.textContent);
    const selected = document.querySelector('#step-list li.step.selected');
    return { items, selected: selected ? selected.dataset.id : null,
             shown: !document.getElementById('context').hidden };
  })()`);

  check('a step has its own menu', rowMenu.shown);
  // Otherwise "Delete step" on the menu and on the toolbar act on different
  // steps, which is the worst way for a delete to behave.
  check('right-clicking selects the row first', rowMenu.selected === 's3');
  check('it can add a note or a heading',
        rowMenu.items.some((t) => /note/.test(t))
        && rowMenu.items.some((t) => /heading/.test(t)));
  check('leave the step out of the guide',
        rowMenu.items.some((t) => /Leave out/.test(t)));
  check('and delete it', rowMenu.items.some((t) => /Delete step/.test(t)));

  const menuUndo = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const before = (await window.bsr.__called()).slice();
    [...document.querySelectorAll('#context button')]
      .find((b) => /Undo/.test(b.textContent)).click();
    await sleep(200);

    // And by keyboard, which must reach the same place.
    document.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'y', ctrlKey: true, bubbles: true }));
    await sleep(200);
    document.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'z', ctrlKey: true, shiftKey: true, bubbles: true }));
    await sleep(200);

    const after = (await window.bsr.__called()).slice();
    return { added: after.slice(before.length) };
  })()`);

  check('the menu item actually goes back', menuUndo.added[0] === 'undo');
  check('Ctrl+Y goes forward', menuUndo.added[1] === 'redo');
  check('and so does Ctrl+Shift+Z', menuUndo.added[2] === 'redo');

  const escaped = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const row = document.querySelector('#step-list li[data-id="s3"]');
    const b = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: b.left + 20, clientY: b.top + 8 }));
    await sleep(80);
    const opened = !document.getElementById('context').hidden;
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(80);
    return { opened, closed: document.getElementById('context').hidden };
  })()`);

  check('Escape closes it', escaped.opened && escaped.closed);

  // ---- rebinding the global hotkeys ----------------------------------------
  // The two chords that have to work while another application is in front.
  // Rebinding them is three hops - a keypress caught at the window, an
  // accelerator built from it, a write in the main process - and none of it
  // was covered here.

  console.log('\nrebinding a global hotkey:');

  const rebind = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = document.getElementById('keysdlg');

    document.getElementById('btn-shortcuts').click();
    await sleep(200);
    const opened = dlg.open;
    const before = document.getElementById('k-pause').textContent;

    // "Change" on the pause row, then the chord.
    const set = dlg.querySelector('.k-set[data-which="pause"]');
    set.click();
    await sleep(80);
    const listening = set.closest('.keyrow').classList.contains('listening');

    set.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F8', code: 'F8', ctrlKey: true, shiftKey: true, bubbles: true,
    }));
    await sleep(250);

    const keys = await window.bsr.__keys();
    return {
      opened, before, listening,
      after: document.getElementById('k-pause').textContent,
      stillListening: set.closest('.keyrow').classList.contains('listening'),
      error: document.getElementById('k-error').hidden
        ? '' : document.getElementById('k-error').textContent,
      calls: keys.calls,
      captured: keys.captured,
      stored: keys.values.hotkeyPause,
    };
  })()`);

  // The bug this was reported for: the application's own hotkeys are taken at
  // the operating system, ahead of this window, so until they are released the
  // chord being replaced never reaches the page at all.
  check('listening releases the global hotkeys first',
        rebind.captured[0] === true);
  check('and choosing one puts them back', rebind.captured.includes(false));

  check('the dialog opens', rebind.opened);
  check('and shows the current chord', /Ctrl.*Shift.*F9/.test(rebind.before));
  check('Change starts listening', rebind.listening);
  check('the keypress reaches the main process',
        rebind.calls.length === 1 && rebind.calls[0].which === 'pause');
  check('as an accelerator, not a raw key',
        rebind.calls.length > 0 && rebind.calls[0].accelerator === 'Control+Shift+F8');
  check('it is kept', rebind.stored === 'Control+Shift+F8');
  check('nothing was refused', rebind.error === '');
  check('the row stops listening', !rebind.stillListening);
  // The whole point: the user has to SEE that it changed.
  check('and the dialog shows the new chord', /Ctrl.*Shift.*F8/.test(rebind.after));

  const unusable = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = document.getElementById('keysdlg');
    const set = dlg.querySelector('.k-set[data-which="stop"]');
    const before = (await window.bsr.__keys()).calls.length;
    set.click();
    await sleep(80);

    // A key that cannot end a global shortcut. This used to be answered the
    // same way as a bare modifier - by waiting in silence - so the dialog
    // looked broken.
    set.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'ScrollLock', code: 'ScrollLock', ctrlKey: true, bubbles: true }));
    await sleep(150);
    const said = document.getElementById('k-error').hidden
      ? '' : document.getElementById('k-error').textContent;
    const stillListening = set.closest('.keyrow').classList.contains('listening');

    // Still listening, so a good one straight after must work.
    set.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: true, bubbles: true }));
    await sleep(250);

    const keys = await window.bsr.__keys();
    return { said, stillListening, stored: keys.values.hotkeyStop,
             tried: keys.calls.length - before };
  })()`);

  check('a key that cannot be used says so', /ScrollLock/.test(unusable.said));
  check('and does not bother the main process', unusable.tried === 1);
  check('the row keeps listening, so you can try another',
        unusable.stillListening);
  check('an arrow key is a perfectly good shortcut',
        unusable.stored === 'Control+Alt+Up');

  const clash = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const dlg = document.getElementById('keysdlg');
    const set = dlg.querySelector('.k-set[data-which="stop"]');
    set.click();
    await sleep(80);
    // The one the other action already has.
    set.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'F8', code: 'F8', ctrlKey: true, shiftKey: true, bubbles: true,
    }));
    await sleep(250);
    return { error: document.getElementById('k-error').hidden
               ? '' : document.getElementById('k-error').textContent,
             stop: document.getElementById('k-stop').textContent };
  })()`);

  check('a chord the other action owns is refused', /cannot share/.test(clash.error));
  check('and the old one is left alone', /Ctrl.*Alt.*Up/.test(clash.stop));

  // Again, but with input delivered the way Electron delivers a real key press
  // rather than a JavaScript event dispatched at an element. This goes through
  // the window's own input path - which is where a difference between "works
  // in a test" and "does nothing in the application" would hide.
  await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('keysdlg')
      .querySelector('.k-set[data-which="stop"]').click();
    await sleep(80);
    window.__seen = [];
    window.addEventListener('keydown', (e) => window.__seen.push(e.key), true);
    return true;
  })()`);

  for (const mod of ['Control', 'Shift']) {
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode: mod });
  }
  win.webContents.sendInputEvent(
    { type: 'keyDown', keyCode: 'F7', modifiers: ['control', 'shift'] });
  await new Promise((r) => setTimeout(r, 300));

  const real = await win.webContents.executeJavaScript(`(async () => {
    const keys = await window.bsr.__keys();
    return { seen: window.__seen, stored: keys.values.hotkeyStop,
             shown: document.getElementById('k-stop').textContent,
             calls: keys.calls.length };
  })()`);

  check('a real key press reaches the page at all', real.seen.length > 0);
  check('modifiers first, then the key',
        real.seen.includes('Control') && real.seen.includes('F7'));
  check('and a real press rebinds it too', real.stored === 'Control+Shift+F7');
  check('with the dialog showing it', /Ctrl.*Shift.*F7/.test(real.shown));

  const closed = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('k-close').click();
    await sleep(150);
    return { open: document.getElementById('keysdlg').open };
  })()`);

  check('Done closes it', !closed.open);

  // ---- searching every recording -------------------------------------------
  console.log('\nsearching the whole archive:');

  const arch = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = document.getElementById('library-query');

    // Back to the library screen the way a person gets there.
    document.getElementById('btn-library').click();
    await sleep(200);
    q.value = 'Save';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);

    const rows = [...document.querySelectorAll('#library-list .lib-row')];
    const hits = [...document.querySelectorAll('.lib-hit')];
    return {
      found: document.getElementById('library-found').textContent,
      rows: rows.length,
      hits: hits.filter((h) => !h.classList.contains('lib-more')).length,
      firstHit: hits.length ? hits[0].textContent : '',
      marks: document.querySelectorAll('#library-list mark').length,
      more: (document.querySelector('.lib-more') || {}).textContent || '',
    };
  })()`);

  check('a query finds the recording', arch.rows === 1);
  check('and says how many', arch.found === '1 recording');
  check('the matching lines are shown', arch.hits === 2);
  check('numbered by their place in the recording', /^2/.test(arch.firstHit.trim()));
  check('with the matched words picked out', arch.marks >= 3);
  check('and it says what it did not show', /2 more/.test(arch.more));

  const opened = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // Clicking a line, not the row: this is what makes it a way in rather than
    // a filter - it should open the recording ON that step.
    document.querySelectorAll('.lib-hit')[1].click();
    await sleep(400);
    const sel = document.querySelector('#step-list li.step.selected');
    return { id: sel ? sel.dataset.id : null,
             query: document.getElementById('library-query').value };
  })()`);

  check('clicking a line opens the recording at that step', opened.id === 'n1');

  // ---- and back out of it --------------------------------------------------
  // The pane has two states, and until this there was no way out of the second.
  // Opening a search result threw away the results, which is the one case
  // where getting back matters most: the query is the work.

  const back = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const home = document.getElementById('btn-library');
    const wasOffered = !home.disabled;

    home.click();
    await sleep(400);

    const showing = !document.getElementById('detail-empty').hidden
                 && document.getElementById('detail-body').hidden;
    return {
      wasOffered, showing,
      greyed: home.disabled,
      query: document.getElementById('library-query').value,
      found: document.getElementById('library-found').textContent,
      hits: document.querySelectorAll('.lib-hit').length,
      current: document.querySelectorAll('.lib-row.current').length,
      // The recording is not closed, only hidden behind the library.
      steps: document.querySelectorAll('#step-list li.step').length,
      stillSelected: (document.querySelector('#step-list li.selected') || {}).dataset,
    };
  })()`);

  if (process.env.BSR_SHOTS) {
    fs.writeFileSync(path.join(process.env.BSR_SHOTS, 'back-to-recordings.png'),
                     (await win.webContents.capturePage()).toPNG());
  }

  check('a way back is offered once you are in a recording', back.wasOffered);
  check('and it shows the recordings again', back.showing);
  check('greyed out once you are there, rather than doing nothing', back.greyed);
  // Arriving back at "Recent recordings" after searching is the same dead end
  // from the other direction.
  check('the search survives the round trip', back.query === 'Save');
  check('results and all', back.found === '1 recording' && back.hits === 2);
  check('with the one you were just in marked', back.current === 1);
  check('and the recording is still open, not closed', back.steps === 4);
  check('on the step you were on', back.stillSelected && back.stillSelected.id === 'n1');

  const backIn = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    // The step list is the way back IN, which is why the selection is kept.
    document.querySelector('#step-list li[data-id="n1"]').click();
    await sleep(250);
    return { showing: !document.getElementById('detail-body').hidden,
             offered: !document.getElementById('btn-library').disabled };
  })()`);

  check('and clicking the step you were on returns you to it', backIn.showing);
  check('with the way back offered again', backIn.offered);

  const cleared = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = document.getElementById('library-query');
    q.value = 'nothing-like-this';
    q.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    const none = document.getElementById('library-found').textContent;

    q.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(400);
    return { none, after: q.value,
             rows: document.querySelectorAll('#library-list .lib-row').length,
             found: document.getElementById('library-found').textContent };
  })()`);

  check('a query that matches nothing says so', cleared.none === 'nothing found');
  check('Escape clears the box', cleared.after === '');
  check('and the recent recordings come back', cleared.rows === 1);
  check('with the count cleared', cleared.found === '');

  // ---- settings -----------------------------------------------------------
  console.log('\nsettings, one group at a time:');

  const tabs = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('btn-settings').click();
    await sleep(300);

    const strip = [...document.querySelectorAll('#settings-tabs .tab')];
    const shown = () => [...document.querySelectorAll('#settings .tabpanel')]
      .filter((p) => !p.hasAttribute('hidden')).map((p) => p.id);

    const opened = shown();
    // The thing this replaced: everything in one column.
    const onlyOne = opened.length === 1;

    strip.find((b) => b.dataset.tab === 'exports').click();
    await sleep(120);
    const afterClick = shown();
    const marked = strip.filter((b) => b.getAttribute('aria-selected') === 'true')
                        .map((b) => b.dataset.tab);

    // The export controls have to be reachable, not merely present.
    const brand = document.getElementById('set-brand');
    const visible = brand.getBoundingClientRect().height > 0;

    // Arrow keys along the strip.
    document.getElementById('settings-tabs').dispatchEvent(new KeyboardEvent(
      'keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(120);
    const wrapped = shown();

    document.getElementById('set-close').click();
    await sleep(150);

    return { labels: strip.map((b) => b.textContent.trim()),
             opened, onlyOne, afterClick, marked, visible, wrapped };
  })()`);

  check('there is a tab for each group',
        tabs.labels.join('|') === 'Recording|Screenshots|Marking up|Exports');
  check('one panel at a time', tabs.onlyOne && tabs.opened[0] === 'tab-recording');
  check('choosing one shows it', tabs.afterClick[0] === 'tab-exports');
  check('and only it', tabs.afterClick.length === 1);
  check('the strip says which you are on',
        tabs.marked.length === 1 && tabs.marked[0] === 'exports');
  check('its controls are actually on screen, not just in the document',
        tabs.visible);
  check('the arrows walk along the strip, and wrap',
        tabs.wrapped[0] === 'tab-recording');

  const reopened = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('btn-settings').click();
    await sleep(250);
    const first = [...document.querySelectorAll('#settings .tabpanel')]
      .find((p) => !p.hasAttribute('hidden')).id;
    document.getElementById('set-close').click();
    await sleep(120);

    // The notice about screenshot size opens the tab that can fix it.
    document.getElementById('notice-settings').click();
    await sleep(300);
    const fromNotice = [...document.querySelectorAll('#settings .tabpanel')]
      .find((p) => !p.hasAttribute('hidden')).id;
    document.getElementById('set-close').click();
    await sleep(120);
    return { first, fromNotice };
  })()`);

  // Somebody who is in Exports is usually in Exports several times running.
  check('it reopens where you left it', reopened.first === 'tab-recording');
  check('but a notice opens the tab it is about',
        reopened.fromNotice === 'tab-screenshots');

  if (process.env.BSR_SHOTS) {
    for (const tab of ['recording', 'screenshots', 'marking', 'exports']) {
      await win.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const dlg = document.getElementById('settings');
        if (!dlg.open) { document.getElementById('btn-settings').click(); await sleep(300); }
        document.querySelector('#settings-tabs .tab[data-tab="${tab}"]').click();
        await sleep(150);
        return true;
      })()`);
      await new Promise((r) => setTimeout(r, 250));
      fs.writeFileSync(path.join(process.env.BSR_SHOTS, `settings-${tab}.png`),
                       (await win.webContents.capturePage()).toPNG());
    }
    await win.webContents.executeJavaScript(
      `document.getElementById('settings').close(); true`);
    await new Promise((r) => setTimeout(r, 200));
  }

  // Last, so it covers everything above it. The original defect here was a
  // ReferenceError, which is invisible to every other assertion if it happens
  // to leave the page in a passable state.
  console.log('\nthe page ran clean:');
  const alerts = await win.webContents.executeJavaScript('window.__alerts');
  check('nothing gave up and raised a dialog', alerts.length === 0);
  if (alerts.length) for (const a of alerts.slice(0, 5)) console.log('    ' + a);
  check('no errors on the console', errors.length === 0);
  if (errors.length) for (const e of errors.slice(0, 5)) console.log('    ' + e);

  fs.rmSync(preloadDir, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
