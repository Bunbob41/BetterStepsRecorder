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
// The third argument is what the failure looked like. It was accepted and
// thrown away for most of this file's life, so a run that failed said only
// that it had - and every diagnostic anybody had bothered to pass went
// straight to nowhere.
const check = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS ' + n); return; }
  fail++;
  console.log('  FAIL ' + n + (extra ? `
        ${extra}` : ''));
};

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
  moveMarker: (id, at, angle) => {
    const step = SESSION.steps.find((x) => x.id === id);
    if (!step) return { ok: false, error: 'Step not found.' };
    if (at) step.markerAt = { x: at.x, y: at.y };
    else delete step.markerAt;
    // The real handler writes both fields in one change; a stub that dropped
    // the angle would report a drag as losing the direction it had settled.
    if (angle !== undefined) {
      if (Number.isFinite(angle)) step.markerAngle = ((Math.round(angle) % 360) + 360) % 360;
      else delete step.markerAngle;
    }
    LAST_MARKER = { id, at: at ? { ...at } : null,
                    angle: angle === undefined ? undefined : angle };
    DEPTH = { undo: DEPTH.undo + 1, redo: 0 };
    depthListener(DEPTH);
    return { ok: true, step };
  },
  setMarks: (id, marks) => {
    const step = SESSION.steps.find((x) => x.id === id);
    if (!step) return { ok: false, error: 'Step not found.' };
    step.marks = (marks || []).length ? marks : undefined;
    step.annotated = Boolean(step.marks) || step.redacted === true;
    return { ok: true, step };
  },
  turnMarker: (id, angle) => {
    const step = SESSION.steps.find((x) => x.id === id);
    if (!step) return { ok: false, error: 'Step not found.' };
    if (Number.isFinite(angle)) step.markerAngle = ((Math.round(angle) % 360) + 360) % 360;
    else delete step.markerAngle;
    return { ok: true, step };
  },
  hideMarker: (id, hidden) => {
    const step = SESSION.steps.find((x) => x.id === id);
    if (!step) return { ok: false, error: 'Step not found.' };
    if (hidden) step.markerHidden = true; else delete step.markerHidden;
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
// The hotkey arrives as an event from the main process, so the stub has to
// hold the page's listener and be able to fire it.
let onHotkey = () => {};
bridge.onHotkey = (fn) => { onHotkey = fn; };
bridge.__hotkey = async (message) => { onHotkey(message); return true; };
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

  // Reported from a real session: "I tried to right click and it actually
  // placed an arrow." With a tool armed, the drawing mousedown never asked
  // which button had been pressed - so a right-click both opened the menu and
  // drew a mark, and the mark was the last thing the author wanted at the
  // moment they were reaching for a menu to get rid of one.
  // What the whole data-instead-of-pixels change was for. A mark used to be
  // paint on the screenshot, so the answer to "delete this arrow" was undo, in
  // order, taking every later mark with it.
  console.log('\ndrawing a mark, then getting rid of it:');
  const marks = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const layer = document.getElementById('marks');
    const r = shot.getBoundingClientRect();

    document.querySelector('#step-list li[data-id="s2"]').click();
    await sleep(250);

    // Draw a box across the middle of the picture.
    document.getElementById('btn-box').click();
    await sleep(20);
    const at = (fx, fy) => ({ clientX: Math.round(r.left + r.width * fx),
                              clientY: Math.round(r.top + r.height * fy) });
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.3, 0.3) }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...at(0.7, 0.7) }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.7, 0.7) }));
    await sleep(300);

    const drawn = layer.querySelectorAll('[data-mark]').length;
    const step = () => window.__steps && window.__steps.find((x) => x.id === 's2');
    document.getElementById('btn-box').click();   // disarm
    await sleep(20);

    // Right-click INSIDE the box, and read what the menu offers.
    wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...at(0.5, 0.5) }));
    await sleep(80);
    const labels = [...document.querySelectorAll('#context button')]
      .map((b) => b.textContent);
    // Right-clicking a mark takes hold of it, so the menu, the strip and the
    // handles are all talking about the same one.
    const held = { bar: !document.getElementById('mark-bar').hidden,
                   kind: document.getElementById('mark-kind').textContent,
                   handles: document.querySelectorAll('#mark-handles .mark-handle').length };

    // Four colours were four lines of an eleven-line menu. Hovered, not
    // clicked: hovering is how a submenu is opened by hand, and a group that
    // only opens on a click is a group nobody finds.
    const group = [...document.querySelectorAll('#context button')]
      .find((b) => /Change colour/.test(b.textContent));
    if (group) group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(80);
    const subLabels = [...document.querySelectorAll('#context-sub button')]
      .map((b) => b.textContent);
    const ticked = [...document.querySelectorAll('#context-sub button.chosen')]
      .map((b) => b.textContent);
    const swatches = document.querySelectorAll('#context-sub .swatch').length;

    // Moving onto anything else in the parent menu puts it away again.
    const other = [...document.querySelectorAll('#context button')]
      .find((b) => /Delete this box/.test(b.textContent));
    if (other) other.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(60);
    const subClosed = document.getElementById('context-sub').hidden;

    if (group) group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(80);
    const blue = [...document.querySelectorAll('#context-sub button')]
      .find((b) => b.textContent.trim() === 'Blue');
    if (blue) blue.click();
    await sleep(300);
    const afterColour = layer.innerHTML;
    const bothClosed = document.getElementById('context').hidden
                    && document.getElementById('context-sub').hidden;

    // Right-click it again and delete it.
    wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...at(0.5, 0.5) }));
    await sleep(80);
    const del = [...document.querySelectorAll('#context button')]
      .find((b) => /Delete this box/.test(b.textContent));
    if (del) del.click();
    await sleep(300);
    const left = layer.querySelectorAll('[data-mark]').length;

    // And right-clicking away from any mark must not offer to delete one.
    wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...at(0.05, 0.9) }));
    await sleep(80);
    const awayLabels = [...document.querySelectorAll('#context button')]
      .map((b) => b.textContent);
    document.getElementById('context').hidden = true;

    return { drawn, labels, afterColour, left, awayLabels, held,
             subLabels, ticked, swatches, subClosed, bothClosed };
  })()`);

  check('a drag draws a mark on the overlay', marks.drawn === 1,
        `${marks.drawn} on the layer`);
  check('right-clicking it offers to delete it',
        marks.labels.some((l) => /Delete this box/.test(l)), marks.labels.join(' | '));
  check('right-clicking it takes hold of it',
        marks.held.bar && marks.held.kind === 'Box',
        `strip: ${marks.held.bar}, about a ${marks.held.kind}`);
  check('and puts its corners on the picture', marks.held.handles === 4,
        `${marks.held.handles} handles`);
  // Reported as "we can probably file the colour options under one Change
  // colour". They were four lines of an eleven-line menu, and one of the two
  // reasons the menu had eleven lines.
  check('the colours are one item, not one line each',
        marks.labels.some((l) => /Change colour/.test(l))
        && !marks.labels.some((l) => /Make this box/.test(l)),
        marks.labels.join(' | '));
  check('and hovering it opens them beside it',
        marks.subLabels.length === 5, marks.subLabels.join(' | '));
  check('each with the colour it is',
        marks.swatches === 5, `${marks.swatches} swatches`);
  check('and a tick on the one it already is',
        marks.ticked.length === 1 && /Red/.test(marks.ticked[0]),
        marks.ticked.join(' | '));
  check('moving onto another item closes them again', marks.subClosed);
  check('and choosing a colour closes the whole menu', marks.bothClosed);
  check('changing the colour redraws it in that colour',
        /#2f6fed/.test(marks.afterColour));
  check('deleting it takes it off the picture', marks.left === 0,
        `${marks.left} left`);
  check('and right-clicking bare picture offers no deletion',
        !marks.awayLabels.some((l) => /Delete this/.test(l)),
        marks.awayLabels.join(' | '));

  console.log('\nwriting a label on the picture:');
  const label = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const layer = document.getElementById('marks');
    const box = document.getElementById('label-input');
    const r = shot.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: Math.round(r.left + r.width * fx),
                              clientY: Math.round(r.top + r.height * fy) });

    document.querySelector('#step-list li[data-id="s3"]').click();
    await sleep(250);

    document.getElementById('btn-text').click();
    await sleep(20);
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.4, 0.5) }));
    await sleep(60);

    const opened = !box.hidden;
    // Where it is typed matters: a caption written three inches from the spot
    // it is about is how labels end up pointing at nothing.
    const onPicture = box.getBoundingClientRect();
    const nearClick = Math.abs(onPicture.left - (r.left + r.width * 0.4)) < 40;

    box.value = 'Check the serial number here';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(300);

    const written = layer.querySelector('text');
    const closed = box.hidden;

    // Retyping it through the menu.
    document.getElementById('btn-text').click();   // disarm
    await sleep(20);
    wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...at(0.42, 0.49) }));
    await sleep(80);
    const edit = [...document.querySelectorAll('#context button')]
      .find((b) => /Edit this label/.test(b.textContent));
    const hasEdit = Boolean(edit);
    if (edit) edit.click();
    await sleep(120);
    const reopenedWith = box.value;
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(80);

    // And emptying one deletes it, which is what a person means by clearing it.
    wrap.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, ...at(0.42, 0.49) }));
    await sleep(80);
    const again = [...document.querySelectorAll('#context button')]
      .find((b) => /Edit this label/.test(b.textContent));
    if (again) again.click();
    await sleep(120);
    box.value = '   ';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(300);
    const leftAfterEmptying = layer.querySelectorAll('[data-mark]').length;

    return { opened, nearClick, text: written ? written.textContent : null,
             closed, hasEdit, reopenedWith, leftAfterEmptying };
  })()`);

  check('the Label tool opens a box on the picture', label.opened);
  check('at the spot that was clicked', label.nearClick);
  check('the words become a mark', label.text === 'Check the serial number here',
        String(label.text));
  check('and the box closes once they are written', label.closed);
  check('right-clicking a label offers to retype it', label.hasEdit);
  check('with the words it already has', label.reopenedWith === 'Check the serial number here',
        String(label.reopenedWith));
  check('and emptying it takes the label away', label.leftAfterEmptying === 0,
        `${label.leftAfterEmptying} left`);

  // Reported from a real screenshot: a label lands where you clicked, and where
  // you clicked is not always where it belongs. Before this the only fix was to
  // delete it and type it again.
  // Everything the markup says is hidden must actually be invisible.
  //
  // `hidden` is an attribute the browser styles with `display: none` at the
  // lowest possible priority, so ANY rule that sets display on the same element
  // beats it. A `.mark-bar { display: flex }` was enough to put a strip of
  // controls on screen permanently, describing a mark nobody had selected -
  // while `el.hidden` read true the whole time, so nothing that asked the DOM
  // was told otherwise. It was found by looking at a screenshot.
  //
  // This is the same trap as the one in the header of this file, where setting
  // `.hidden` on an <svg> defined a JavaScript property and left the attribute
  // alone. Both come from treating "hidden" as one idea when it is two.
  console.log('\nwhat the markup hides is hidden:');
  const hiding = await win.webContents.executeJavaScript(`(async () => {
    const showing = [];
    for (const node of document.querySelectorAll('[hidden]')) {
      const style = getComputedStyle(node);
      if (style.display !== 'none') {
        showing.push((node.id || node.className || node.tagName)
          + ' (display: ' + style.display + ')');
      }
    }
    return { count: document.querySelectorAll('[hidden]').length, showing };
  })()`);

  check(`every element marked hidden is invisible (${hiding.count} checked)`,
        hiding.showing.length === 0, hiding.showing.join(', '));

  console.log('\nfolding the steps column away:');
  const folded = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const list = document.getElementById('step-list');
    const rail = document.getElementById('btn-steps-expand');
    // The PANE, not the <img>: a picture stops at its natural width, so it
    // cannot show that the space around it grew.
    const pane = document.querySelector('.detail');

    document.querySelector('#step-list li[data-id="s2"]').click();
    await sleep(250);
    const wideBefore = Math.round(pane.getBoundingClientRect().width);
    const railBefore = getComputedStyle(rail).display;

    document.getElementById('btn-steps-collapse').click();
    await sleep(250);
    // Everything in the column, not the handful of things that were in it when
    // the fold was written. "No steps yet." was left out of that list and
    // wrapped itself down the thirty-pixel rail one letter at a time, which is
    // what a person saw and no check did.
    //
    // Judged as an EMPTY recording, because that is the only state the message
    // is shown in - with steps in the list it is hidden, and a folded column
    // looks perfect while the bug is sitting there waiting for the first person
    // to open the app before recording anything.
    document.getElementById('empty').hidden = false;
    await sleep(60);
    const strays = [...document.querySelectorAll('.steps > *')]
      .filter((n) => !n.classList.contains('steps-rail'))
      .filter((n) => getComputedStyle(n).display !== 'none')
      .map((n) => n.id || n.className || n.tagName);

    document.getElementById('empty').hidden = true;   // put it back

    const collapsed = {
      strays,
      listShown: getComputedStyle(list).display !== 'none',
      rail: getComputedStyle(rail).display,
      count: document.getElementById('rail-count').textContent,
      wide: Math.round(pane.getBoundingClientRect().width),
      // The step stays selected: this is a view, not a mode.
      stillSelected: Boolean(document.querySelector('#step-list li.selected')),
    };

    // Arrow keys still move between steps with the column folded, which is what
    // stops it being somewhere you can get stuck.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await sleep(250);
    const movedWhileFolded = document.querySelector('#step-list li.selected')
      ? document.querySelector('#step-list li.selected').dataset.id : null;

    // Ctrl+B brings it back.
    document.dispatchEvent(new KeyboardEvent('keydown',
      { key: 'b', ctrlKey: true, bubbles: true }));
    await sleep(250);
    const back = {
      listShown: getComputedStyle(list).display !== 'none',
      rail: getComputedStyle(rail).display,
      wide: Math.round(pane.getBoundingClientRect().width),
    };

    return { wideBefore, railBefore, collapsed, movedWhileFolded, back };
  })()`);

  check('the rail is out of the way while the list is showing',
        folded.railBefore === 'none');
  check('folding hides the list', folded.collapsed.listShown === false);
  check('and everything else in the column with it',
        folded.collapsed.strays.length === 0,
        `still showing: ${folded.collapsed.strays.join(', ')}`);
  check('and leaves a rail to bring it back',
        folded.collapsed.rail !== 'none');
  check('with the number of steps still in view',
        folded.collapsed.count === '4', folded.collapsed.count);
  // The whole point: the picture gets the room.
  check('the picture gets the space',
        folded.collapsed.wide > folded.wideBefore + 200,
        `${folded.wideBefore}px -> ${folded.collapsed.wide}px`);
  check('and the step you were on stays selected', folded.collapsed.stillSelected);
  // The row after s2 is the note n1, and a note is a row you can land on.
  check('arrow keys still move between rows while it is folded',
        folded.movedWhileFolded === 'n1', String(folded.movedWhileFolded));
  check('Ctrl+B brings the list back', folded.back.listShown === true);
  check('and puts the rail away again', folded.back.rail === 'none');
  check('and the picture returns to its old width',
        Math.abs(folded.back.wide - folded.wideBefore) <= 2,
        `${folded.wideBefore}px -> ${folded.back.wide}px`);

  console.log('\ntaking hold of a mark:');
  const grabbed = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const layer = document.getElementById('marks');
    const bar = document.getElementById('mark-bar');
    const box = document.getElementById('label-input');
    const r = shot.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: Math.round(r.left + r.width * fx),
                              clientY: Math.round(r.top + r.height * fy) });

    document.querySelector('#step-list li[data-id="s1"]').click();
    await sleep(250);

    // A label at a quarter across, half way down.
    document.getElementById('btn-text').click();
    await sleep(20);
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.25, 0.5) }));
    await sleep(60);
    box.value = 'woah';
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await sleep(300);
    document.getElementById('btn-text').click();     // disarm
    await sleep(20);

    const barBefore = !bar.hidden;
    const pictureBefore = shot.getBoundingClientRect().top;
    const where = () => {
      const t = layer.querySelector('text');
      return t ? Math.round(Number(t.getAttribute('x'))) : null;
    };
    const startX = where();

    // Click it: the strip appears and says what it is.
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.26, 0.49) }));
    await sleep(60);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.26, 0.49) }));
    await sleep(200);
    const pictureAfter = shot.getBoundingClientRect().top;
    const selected = { shown: !bar.hidden,
                       kind: document.getElementById('mark-kind').textContent,
                       sizeShown: !document.getElementById('mark-size-wrap').hidden,
                       outline: Boolean(layer.querySelector('.mark-selection')),
                       swatches: document.querySelectorAll('#mark-colours button').length,
                       moved: Math.round(pictureAfter - pictureBefore) };

    // Drag it to the right.
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.26, 0.49) }));
    await sleep(30);
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...at(0.6, 0.49) }));
    await sleep(60);
    const during = where();
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.6, 0.49) }));
    await sleep(300);
    const afterMove = where();

    // The controls are PRESSED, with a mouse, not called.
    //
    // Calling .click() on a button skips the mousedown, and the mousedown was
    // the whole bug: the strip floats inside the picture's wrapper, so pressing
    // anything on it is also a press on the picture - which deselected the mark
    // and took the button out of the document before the click could land.
    // Reported as "I cannot interact with its options" while every check here
    // passed.
    // Judged at the mousedown, and reported. A click dispatched at a saved node
    // fires its handler even if the strip has just been taken off screen, so
    // asking afterwards whether the colour changed says nothing about whether a
    // real mouse could have done it: the click a real mouse sends goes to
    // whatever is under the pointer when the button comes up, and if the strip
    // has gone, that is the picture.
    const press = async (node) => {
      const b = node.getBoundingClientRect();
      const where = { clientX: Math.round(b.left + b.width / 2),
                      clientY: Math.round(b.top + b.height / 2), bubbles: true,
                      button: 0 };
      node.dispatchEvent(new MouseEvent('mousedown', where));
      await sleep(30);
      // Not "is a strip on screen" - "is it still about the same mark". A press
      // that falls through to the picture can land on a DIFFERENT mark and
      // leave a strip open about that one, which looks identical from here and
      // is not the same thing at all.
      const survived = !bar.hidden
        && document.getElementById('mark-kind').textContent === 'Label';
      node.dispatchEvent(new MouseEvent('mouseup', where));
      node.dispatchEvent(new MouseEvent('click', where));
      await sleep(250);
      return survived;
    };

    // A colour, by pressing its swatch.
    const colourBefore = layer.querySelector('text').getAttribute('fill');
    const swatch = document.querySelectorAll('#mark-colours button')[1];
    const stillSelectedAfterSwatch = await press(swatch);
    const kindAfterSwatch = document.getElementById('mark-kind').textContent;
    const colourAfter = layer.querySelector('text')
      ? layer.querySelector('text').getAttribute('fill') : null;

    // And the size. A native dropdown cannot be opened from script, so what is
    // checked is that pressing it does not dismiss the strip - which is what
    // stopped it ever being opened by hand.
    const size = document.getElementById('mark-size');
    const sizeBox = size.getBoundingClientRect();
    size.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0,
        clientX: Math.round(sizeBox.left + sizeBox.width / 2),
        clientY: Math.round(sizeBox.top + sizeBox.height / 2) }));
    await sleep(120);
    const stillSelectedAfterSize = !bar.hidden
      && document.getElementById('mark-kind').textContent === 'Label';

    const fontBefore = Number(layer.querySelector('text').getAttribute('font-size'));
    size.value = 'large';
    size.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    const fontAfter = Number(layer.querySelector('text').getAttribute('font-size'));

    // And Escape lets go without changing anything.
    const activeAtEscape = document.activeElement
      ? document.activeElement.tagName : 'none';
    // On document, where the window's keyboard handler actually listens.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    const letGo = bar.hidden;

    // Clean up after ourselves: this step belongs to the checks that follow.
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.6, 0.49) }));
    await sleep(60);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.6, 0.49) }));
    await sleep(150);
    const barBeforeDelete = !bar.hidden;
    const marksBeforeDelete = layer.querySelectorAll('[data-mark]').length;
    document.getElementById('mark-delete').click();
    await sleep(300);
    const left = layer.querySelectorAll('[data-mark]').length;

    return { barBefore, startX, selected, during, afterMove,
             fontBefore, fontAfter, letGo, left, activeAtEscape,
             barBeforeDelete, marksBeforeDelete,
             colourBefore, colourAfter, kindAfterSwatch,
             stillSelectedAfterSwatch, stillSelectedAfterSize };
  })()`);

  check('nothing is selected to begin with', grabbed.barBefore === false);
  check('clicking a mark selects it', grabbed.selected.shown);
  check('and the strip says what it is', grabbed.selected.kind === 'Label',
        grabbed.selected.kind);
  check('with a size, because it is a label', grabbed.selected.sizeShown);
  check('and its colours to choose from', grabbed.selected.swatches === 5,
        `${grabbed.selected.swatches} swatches`);
  check('the selected one is outlined on the picture', grabbed.selected.outline);
  // The strip used to appear in the layout, above the picture, which pushed the
  // screenshot down at the exact moment somebody had clicked a mark on it: the
  // thing just taken hold of moved out from under the pointer, and a drag begun
  // straight afterwards landed somewhere else.
  check('and the picture does not move when it is selected',
        grabbed.selected.moved === 0, `${grabbed.selected.moved}px`);

  check('dragging moves it while the mouse is down',
        grabbed.during !== null && grabbed.during > grabbed.startX + 50,
        `${grabbed.startX} -> ${grabbed.during}`);
  check('and it stays where it was let go',
        grabbed.afterMove !== null && Math.abs(grabbed.afterMove - grabbed.during) < 30,
        `${grabbed.during} -> ${grabbed.afterMove}`);
  check('pressing a swatch keeps the SAME mark in hand',
        grabbed.stillSelectedAfterSwatch,
        `the strip was about a ${grabbed.kindAfterSwatch} afterwards`);
  check('and recolours it',
        grabbed.colourAfter && grabbed.colourAfter !== grabbed.colourBefore,
        `${grabbed.colourBefore} -> ${grabbed.colourAfter}`);
  check('pressing the size control keeps it selected too',
        grabbed.stillSelectedAfterSize);
  check('choosing a larger size redraws it larger',
        grabbed.fontAfter > grabbed.fontBefore, `${grabbed.fontBefore} -> ${grabbed.fontAfter}`);
  check('Escape lets it go', grabbed.letGo,
        `focus was on ${grabbed.activeAtEscape}`);
  // Relative, not absolute: earlier checks in this file draw marks of their own
  // on these steps, and a probe that assumed it had the picture to itself would
  // fail for reasons that have nothing to do with deleting.
  check('and Delete on the strip removes it',
        grabbed.left === grabbed.marksBeforeDelete - 1,
        `${grabbed.marksBeforeDelete} mark(s) before, ${grabbed.left} after`);

  // Reported as "there is no simple rotation of the drawn arrows". There was
  // none at all: an arrow drawn at the wrong angle could be moved, recoloured
  // or deleted, and the only way to change where it pointed was to delete it
  // and draw it again.
  console.log('\naiming an arrow after it is drawn:');
  const aimed = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const handles = document.getElementById('mark-handles');
    const r = shot.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: Math.round(r.left + r.width * fx),
                              clientY: Math.round(r.top + r.height * fy) });

    document.querySelector('#step-list li[data-id="s1"]').click();
    await sleep(250);

    // An arrow across the middle, pointing right.
    document.getElementById('btn-arrow').click();
    await sleep(20);
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.2, 0.5) }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...at(0.6, 0.5) }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.6, 0.5) }));
    await sleep(300);
    document.getElementById('btn-arrow').click();          // disarm
    await sleep(20);

    const beforeSelecting = handles.querySelectorAll('.mark-handle').length;

    // Take hold of it.
    wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.4, 0.5) }));
    await sleep(40);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.4, 0.5) }));
    await sleep(250);

    const dots = handles.querySelectorAll('.mark-handle').length;
    const hint = document.getElementById('mark-hint').textContent;
    // Read off the picture, not out of the page's variables: the renderer
    // hands its steps to nobody, and a handle IS the end of the mark - if the
    // two ever disagreed, the dot somebody grabs would not be on the thing
    // they think they are grabbing.
    const arrow = () => {
      const end = (which, axis) => {
        const dot = handles.querySelector('.mark-handle.h-' + which);
        return dot ? Number.parseFloat(axis === 'x' ? dot.style.left : dot.style.top)
                   : null;
      };
      return { from: { x: end('from', 'x'), y: end('from', 'y') },
               to: { x: end('to', 'x'), y: end('to', 'y') } };
    };
    // And the drawn line, which comes from the committed mark rather than from
    // the handles, so a change that never reached the recording is visible.
    // The LAST arrow on the layer: this step already carries one from the
    // drag-preview checks further up the file, and the first one in the
    // document is that one - which never moves, and reported "no change" for a
    // change that had happened perfectly.
    const drawnTail = () => {
      const arrows = [...document.querySelectorAll('#marks .mark-arrow line')];
      const line = arrows[arrows.length - 1];
      return line ? Math.round(Number(line.getAttribute('y1'))) : null;
    };
    const before = JSON.parse(JSON.stringify(arrow()));
    const drawnBefore = drawnTail();

    // Swing the tail up to the top left. The point is on the thing being
    // pointed at, so it must not move.
    const swing = async (fx, fy, shiftKey) => {
      const tail = handles.querySelector('.mark-handle.h-from');
      const box = tail.getBoundingClientRect();
      tail.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0,
        clientX: Math.round(box.left + box.width / 2),
        clientY: Math.round(box.top + box.height / 2) }));
      await sleep(30);
      window.dispatchEvent(new MouseEvent('mousemove',
        { bubbles: true, shiftKey, ...at(fx, fy) }));
      await sleep(60);
      const live = JSON.parse(JSON.stringify(arrow()));
      window.dispatchEvent(new MouseEvent('mouseup',
        { bubbles: true, button: 0, shiftKey, ...at(fx, fy) }));
      await sleep(300);
      return live;
    };

    const duringSwing = await swing(0.2, 0.1, false);
    const after = JSON.parse(JSON.stringify(arrow()));
    const drawnAfter = drawnTail();

    // And with Shift, off a level line by a hair.
    await swing(0.2, 0.54, true);
    const snapped = JSON.parse(JSON.stringify(arrow()));

    // Arming a tool takes the handles away: a drag that starts on one has to
    // draw a new mark rather than resize the old one.
    document.getElementById('btn-box').click();
    await sleep(60);
    const whileArmed = handles.querySelectorAll('.mark-handle').length;
    document.getElementById('btn-box').click();
    await sleep(60);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    const afterEscape = handles.querySelectorAll('.mark-handle').length;

    return { beforeSelecting, dots, hint, before, duringSwing, after, snapped,
             drawnBefore, drawnAfter, whileArmed, afterEscape };
  })()`);

  // Geometry is not appearance: every measurement below can pass while the dots
  // are drawn in the wrong place, invisible, or on top of one another.
  if (process.env.BSR_SHOTS) {
    await win.webContents.executeJavaScript(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const wrap = document.getElementById('shot-wrap');
      const r = document.getElementById('shot').getBoundingClientRect();
      const at = (fx, fy) => ({ clientX: Math.round(r.left + r.width * fx),
                                clientY: Math.round(r.top + r.height * fy) });
      // Back onto the arrow this probe left on the picture.
      wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(0.32, 0.34) }));
      await sleep(40);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(0.32, 0.34) }));
      await sleep(250);
    })()`);
    const image = await win.webContents.capturePage();
    const out = path.join(process.env.BSR_SHOTS, 'mark-handles.png');
    fs.writeFileSync(out, image.toPNG());
    console.log('    wrote ' + out);
    await win.webContents.executeJavaScript(
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  }

  check('an unselected arrow has no handles on it', aimed.beforeSelecting === 0,
        `${aimed.beforeSelecting} handles`);
  check('selecting it puts one on each end', aimed.dots === 2,
        `${aimed.dots} handles`);
  check('and the strip says how to aim it', /Shift/.test(aimed.hint), aimed.hint);
  check('the drag is drawn while the mouse is down',
        aimed.duringSwing && aimed.duringSwing.from.y < aimed.before.from.y - 10,
        `${aimed.before.from.y} -> ${aimed.duringSwing && aimed.duringSwing.from.y}`);
  check('and dragging the tail turns the arrow',
        aimed.after.from.y < aimed.before.from.y - 10,
        `tail at ${aimed.before.from.y}% -> ${aimed.after.from.y}%`);
  // The whole reason the tail is the handle: the point is on the thing being
  // pointed at, and turning must not take it off it.
  check('while the point stays on what it is pointing at',
        Math.abs(aimed.after.to.x - aimed.before.to.x) < 1
        && Math.abs(aimed.after.to.y - aimed.before.to.y) < 1,
        JSON.stringify(aimed.after.to));
  check('and the arrow on the picture is redrawn from the change',
        aimed.drawnAfter !== null && aimed.drawnAfter < aimed.drawnBefore - 20,
        `the line's tail: ${aimed.drawnBefore}px -> ${aimed.drawnAfter}px`);
  check('and Shift snaps a nearly level arrow level',
        Math.abs(aimed.snapped.from.y - aimed.snapped.to.y) < 0.01,
        `${aimed.snapped.from.y} vs ${aimed.snapped.to.y}`);
  check('arming a tool takes the handles away', aimed.whileArmed === 0,
        `${aimed.whileArmed} handles`);
  check('and letting go of the mark takes them away too', aimed.afterEscape === 0,
        `${aimed.afterEscape} handles`);

  // Found by looking at a window screenshot rather than at a number: the strip
  // floats over the top-left of the picture, and a mark near the top of a
  // screenshot had its handles underneath it.
  console.log('\nthe strip keeps off the mark it is about:');
  const strip = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const bar = document.getElementById('mark-bar');
    const handles = document.getElementById('mark-handles');
    const r = shot.getBoundingClientRect();
    const at = (fx, fy) => ({ clientX: Math.round(r.left + r.width * fx),
                              clientY: Math.round(r.top + r.height * fy) });

    document.querySelector('#step-list li[data-id="s3"]').click();
    await sleep(250);

    const draw = async (tool, x1, y1, x2, y2) => {
      document.getElementById(tool).click();
      await sleep(20);
      wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(x1, y1) }));
      await sleep(15);
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, ...at(x2, y2) }));
      await sleep(15);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(x2, y2) }));
      await sleep(300);
      document.getElementById(tool).click();
      await sleep(20);
    };

    const take = async (fx, fy) => {
      wrap.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, ...at(fx, fy) }));
      await sleep(30);
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0, ...at(fx, fy) }));
      await sleep(200);
      const b = bar.getBoundingClientRect();
      const dots = [...handles.querySelectorAll('.mark-handle')]
        .map((d) => d.getBoundingClientRect());
      return {
        kind: document.getElementById('mark-kind').textContent,
        // A handle underneath the strip is a handle nobody can reach.
        buried: dots.filter((d) => d.left < b.right && d.right > b.left
                                && d.top < b.bottom && d.bottom > b.top).length,
        low: bar.classList.contains('low'),
      };
    };

    // A box across the top left, where a title bar and a menu live.
    await draw('btn-box', 0.05, 0.05, 0.45, 0.3);
    const high = await take(0.25, 0.06);

    // And one across the bottom, which the strip was never in the way of.
    await draw('btn-box', 0.05, 0.7, 0.45, 0.92);
    const low = await take(0.25, 0.71);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(150);
    return { high, low };
  })()`);

  check('a mark at the top of the picture is taken hold of', strip.high.kind === 'Box',
        strip.high.kind);
  check('and the strip moves out from over it', strip.high.low === true);
  check('so none of its handles are buried', strip.high.buried === 0,
        `${strip.high.buried} handle(s) under the strip`);
  check('a mark lower down leaves the strip where it was', strip.low.low === false);
  check('and none of its handles are buried either', strip.low.buried === 0,
        `${strip.low.buried} handle(s) under the strip`);

  console.log('\nthe right button does not draw:');
  const rightClick = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const wrap = document.getElementById('shot-wrap');
    const shot = document.getElementById('shot');
    const sel = document.getElementById('selection');
    const preview = document.getElementById('drag-preview');
    const r = shot.getBoundingClientRect();

    document.getElementById('btn-arrow').click();     // arm it
    await sleep(20);

    wrap.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 2, clientX: r.left + 40, clientY: r.top + 40 }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 160 }));
    await sleep(30);

    const drew = { rubberBand: !sel.hasAttribute('hidden'),
                   preview: !preview.hasAttribute('hidden') };

    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, button: 2, clientX: r.left + 200, clientY: r.top + 160 }));
    await sleep(60);

    // And the left button still does, so this did not simply disable drawing.
    wrap.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0, clientX: r.left + 40, clientY: r.top + 40 }));
    await sleep(15);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 160 }));
    await sleep(30);
    const left = { preview: !preview.hasAttribute('hidden') };
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, button: 0, clientX: r.left + 40, clientY: r.top + 40 }));
    await sleep(60);

    document.getElementById('btn-arrow').click();     // disarm, for what follows
    await sleep(20);
    return { drew, left };
  })()`);

  check('a right-click with the arrow tool armed starts nothing',
        !rightClick.drew.preview && !rightClick.drew.rubberBand,
        JSON.stringify(rightClick.drew));
  check('while the left button still draws', rightClick.left.preview);

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

  // Dispatching mousedown ON the element proves the handler works and proves
  // nothing about whether a mouse can reach it. This asks the browser what is
  // actually at that pixel, which is what a real drag depends on.
  const hit = await win.webContents.executeJavaScript(`(async () => {
    const ind = document.getElementById('indicator');
    const mark = ind.querySelector('.bsr-marker');
    const b = mark.getBoundingClientRect();
    const cx = Math.round(b.left + b.width / 2);
    const cy = Math.round(b.top + b.height / 2);
    const at = document.elementFromPoint(cx, cy);
    return {
      markerPointerEvents: getComputedStyle(mark).pointerEvents,
      layerPointerEvents: getComputedStyle(ind).pointerEvents,
      movable: ind.classList.contains('movable'),
      hitTag: at ? at.tagName : null,
      hitClass: at ? String(at.className || '') : null,
      isTheMarker: Boolean(at && at.closest && at.closest('.bsr-marker')),
      size: { w: Math.round(b.width), h: Math.round(b.height) },
      // The native image drag competes with both marking and moving.
      shotDraggable: getComputedStyle(document.getElementById('shot')).webkitUserDrag,
    };
  })()`);

  console.log('    hit test:', JSON.stringify(hit));
  check('and the screenshot cannot be dragged out of the page',
        hit.shotDraggable === 'none');

  // An arrow can be turned. The handle sits at the tail, because the tip has
  // to stay on the thing being pointed at.
  const turn = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ind = document.getElementById('indicator');
    const shot = document.getElementById('shot');
    const setStyle = async (v) => {
      const sel = document.getElementById('set-marker');
      sel.value = v;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      await sleep(300);
    };

    // A circle has no direction, so no handle.
    const circleHandle = Boolean(ind.querySelector('.rotate-handle'));

    await setStyle('arrow');
    const handle = ind.querySelector('.rotate-handle');
    const mark = ind.querySelector('.bsr-marker');
    if (!handle || !mark) { await setStyle('circle'); return { circleHandle, hadHandle: false }; }

    // The tip, read from where the marker is actually anchored - the element
    // is placed at a percentage and pulled back by its own margins so the tip
    // lands there. Assuming a position is how this probe first went wrong.
    const r = shot.getBoundingClientRect();
    const tipX = r.left + (parseFloat(mark.style.left) / 100) * r.width;
    const tipY = r.top + (parseFloat(mark.style.top) / 100) * r.height;
    const before = mark.getBoundingClientRect();

    const hb = handle.getBoundingClientRect();
    handle.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0,
        clientX: Math.round(hb.left + hb.width / 2),
        clientY: Math.round(hb.top + hb.height / 2) }));
    await sleep(20);
    // Tail directly below the tip: the arrow then points straight up.
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: Math.round(tipX), clientY: Math.round(tipY + 140) }));
    await sleep(60);
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, clientX: Math.round(tipX), clientY: Math.round(tipY + 140) }));
    await sleep(300);

    const after = ind.querySelector('.bsr-marker').getBoundingClientRect();
    const out = {
      circleHandle,
      hadHandle: true,
      beforeBox: { w: Math.round(before.width), h: Math.round(before.height) },
      afterBox: { w: Math.round(after.width), h: Math.round(after.height) },
      nowTall: after.height > after.width * 1.5,
    };

    // Put the style back: everything after this expects a circle.
    await setStyle('circle');
    return out;
  })()`);

  // Moving a turned arrow must not un-turn it, even for the moment the mouse
  // is down. This redrew from the shared options and dropped the step's own
  // angle, so a turned arrow snapped back to the automatic diagonal for the
  // whole drag - which is indistinguishable from not being able to turn it.
  const keepsAngle = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ind = document.getElementById('indicator');
    const shot = document.getElementById('shot');
    const sel = document.getElementById('set-marker');
    sel.value = 'arrow';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);

    // Point it straight up, then take hold of the arrow itself and move it.
    await window.bsr.turnMarker('s2', 270);
    document.querySelector('#step-list li[data-id="s2"]').click();
    await sleep(300);

    const shape = () => {
      const b = ind.querySelector('.bsr-marker').getBoundingClientRect();
      return { w: Math.round(b.width), h: Math.round(b.height) };
    };
    const before = shape();

    const r = shot.getBoundingClientRect();
    const mark = ind.querySelector('.bsr-marker');
    const mb = mark.getBoundingClientRect();
    mark.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0,
        clientX: Math.round(mb.left + mb.width / 2),
        clientY: Math.round(mb.top + mb.height / 2) }));
    await sleep(20);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: Math.round(r.left + r.width * 0.7),
        clientY: Math.round(r.top + r.height * 0.7) }));
    await sleep(80);
    const during = shape();
    const handleDuring = Boolean(ind.querySelector('.rotate-handle'));
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, clientX: Math.round(r.left + r.width * 0.7),
        clientY: Math.round(r.top + r.height * 0.7) }));
    await sleep(300);
    const after = shape();

    // Put the step back exactly as it was found, THROUGH THE APPLICATION.
    // Calling the bridge directly updates the main process and leaves the
    // window's own copy of the steps untouched, so the marker stayed where
    // this probe had dragged it and later checks measured that instead.
    const mark2 = ind.querySelector('.bsr-marker');
    const mb2 = mark2.getBoundingClientRect();
    mark2.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0,
        clientX: Math.round(mb2.left + mb2.width / 2),
        clientY: Math.round(mb2.top + mb2.height / 2) }));
    await sleep(20);
    window.dispatchEvent(new MouseEvent('mousemove',
      { bubbles: true, clientX: Math.round(r.left + r.width * 0.25),
        clientY: Math.round(r.top + r.height * 0.25) }));
    await sleep(60);
    window.dispatchEvent(new MouseEvent('mouseup',
      { bubbles: true, clientX: Math.round(r.left + r.width * 0.25),
        clientY: Math.round(r.top + r.height * 0.25) }));
    await sleep(250);

    // And hand the direction back, from the menu the way a person would.
    document.getElementById('shot-wrap').dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 150 }));
    await sleep(80);
    // Under the marker's own group now, so the group is opened first. Found
    // rather than guarded away: an item that has moved should fail here, not
    // leave the next probe measuring a marker this one turned.
    [...document.querySelectorAll('#context button')]
      .find((b) => /The click marker/.test(b.textContent))
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(80);
    [...document.querySelectorAll('#context-sub button')]
      .find((b) => /the way it chooses/.test(b.textContent)).click();
    await sleep(250);

    sel.value = 'circle';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    return { before, during, after, handleDuring };
  })()`);

  // Pointing straight up is a tall, narrow box; a diagonal is roughly square.
  const pointsUp = (b) => b.h > b.w * 1.5;
  check('a turned arrow is tall before the drag', pointsUp(keepsAngle.before));
  check('and stays turned while it is being moved', pointsUp(keepsAngle.during));
  if (!pointsUp(keepsAngle.during)) console.log('   ', JSON.stringify(keepsAngle));
  check('and after the drag', pointsUp(keepsAngle.after));
  check('with its handle still there mid-drag', keepsAngle.handleDuring);

  // An arrow nobody has turned still works out its own direction, and that
  // answer changes 28% in from the top and the left - so dragging one across
  // that line used to swing it to a different diagonal halfway through the
  // move. Reported as "if I grab the triangle it does your old 45", next to
  // the observation that turning it by the handle first made it stop.
  //
  // Measured as which side of the tip the TAIL is on, because 45 and 135
  // degrees have the same bounding box: a swing is invisible to anything that
  // only looks at the shape.
  console.log('\nmoving an arrow does not re-aim it:');
  const held = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ind = document.getElementById('indicator');
    const shot = document.getElementById('shot');
    const sel = document.getElementById('set-marker');
    sel.value = 'arrow';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(300);
    document.querySelector('#step-list li[data-id="s2"]').click();
    await sleep(300);

    const r = shot.getBoundingClientRect();
    // Where the tail sits relative to the tip, in whole pixels.
    const tail = (px, py) => {
      const h = ind.querySelector('.rotate-handle');
      if (!h) return null;
      const b = h.getBoundingClientRect();
      return { dx: Math.round(b.left + b.width / 2 - (r.left + r.width * px)),
               dy: Math.round(b.top + b.height / 2 - (r.top + r.height * py)) };
    };
    // It starts at a quarter in from each edge, on the far side of the line.
    const before = tail(0.25, 0.25);

    const mark = ind.querySelector('.bsr-marker');
    const mb = mark.getBoundingClientRect();
    mark.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0,
        clientX: Math.round(mb.left + mb.width / 2),
        clientY: Math.round(mb.top + mb.height / 2) }));
    await sleep(20);
    const to = { x: Math.round(r.left + r.width * 0.6),
                 y: Math.round(r.top + r.height * 0.6) };
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: to.x, clientY: to.y }));
    await sleep(80);
    const during = tail(0.6, 0.6);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: to.x, clientY: to.y }));
    await sleep(300);
    const after = tail(0.6, 0.6);
    const sent = await window.bsr.__lastMarker();

    // Back where this found it: dragged home, then handed back to automatic
    // from the menu, so nothing after this measures a step this probe turned.
    const m2 = ind.querySelector('.bsr-marker');
    const b2 = m2.getBoundingClientRect();
    m2.dispatchEvent(new MouseEvent('mousedown',
      { bubbles: true, button: 0,
        clientX: Math.round(b2.left + b2.width / 2),
        clientY: Math.round(b2.top + b2.height / 2) }));
    await sleep(20);
    const home = { x: Math.round(r.left + r.width * 0.25),
                   y: Math.round(r.top + r.height * 0.25) };
    window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: home.x, clientY: home.y }));
    await sleep(60);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: home.x, clientY: home.y }));
    await sleep(250);

    document.getElementById('shot-wrap').dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 150 }));
    await sleep(80);
    [...document.querySelectorAll('#context button')]
      .find((b) => /The click marker/.test(b.textContent))
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(80);
    [...document.querySelectorAll('#context-sub button')]
      .find((b) => /the way it chooses/.test(b.textContent)).click();
    await sleep(250);

    sel.value = 'circle';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(250);
    return { before, during, after, sent };
  })()`);

  const side = (t) => (t ? Math.sign(t.dx) + ',' + Math.sign(t.dy) : 'no handle');
  check('the tail is off to one side before the drag',
        Boolean(held.before) && held.before.dx !== 0 && held.before.dy !== 0,
        JSON.stringify(held.before));
  check('and on the same side of the tip while it is dragged across the line',
        side(held.during) === side(held.before),
        `${side(held.before)} -> ${side(held.during)}`);
  check('and still there once it is let go',
        side(held.after) === side(held.before),
        `${side(held.before)} -> ${side(held.after)}`);
  // Settled with the move, in one change, or a later redraw works it out again.
  check('the direction is written down with the new position',
        Number.isFinite(held.sent && held.sent.angle),
        JSON.stringify(held.sent));

  check('a circle has no handle to turn', turn.circleHandle === false);
  check('an arrow has one', turn.hadHandle === true);
  // Pointing straight up means a tall, narrow box where a diagonal was square.
  check('and swinging the handle below the tip points it up',
        turn.nowTall === true,
        `${JSON.stringify(turn.beforeBox)} -> ${JSON.stringify(turn.afterBox)}`);
  if (!turn.nowTall) console.log('    boxes:', JSON.stringify(turn));
  check('the overlay itself stays transparent to the pointer',
        hit.layerPointerEvents === 'none');
  check('but the marker takes the pointer',
        hit.markerPointerEvents === 'auto', hit.markerPointerEvents);
  check('and the browser finds the marker at the marker',
        hit.isTheMarker,
        `elementFromPoint gave <${hit.hitTag} class="${hit.hitClass}">`);
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

  // The marker overlay is inset:0 on the wrapper, so its percentages are only
  // right while the wrapper is exactly as tall as the picture. As a shrinkable
  // flex item the wrapper was squashed by a short pane and the marker drifted
  // upwards by the difference - on every screenshot taller than the pane.
  const tall = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const wrap = document.getElementById('shot-wrap');

    // A picture far taller than the pane can be.
    shot.style.width = '600px';
    shot.style.height = '1600px';
    await sleep(200);

    const img = shot.getBoundingClientRect();
    const box = wrap.getBoundingClientRect();
    const mark = document.querySelector('#indicator .bsr-marker');
    const m = mark.getBoundingClientRect();

    // Compared against what the marker itself declares, so this holds wherever
    // the marker happens to be by now rather than assuming a position.
    const want = {
      down: parseFloat(mark.style.top) / 100,
      across: parseFloat(mark.style.left) / 100,
    };
    const out = {
      wrapMatchesPicture: Math.abs(box.height - img.height) < 2,
      want,
      down: (m.top + m.height / 2 - img.top) / img.height,
      across: (m.left + m.width / 2 - img.left) / img.width,
    };

    shot.style.height = '';        // leave the pane as it was found
    await sleep(150);
    return out;
  })()`);

  check('the frame around the picture is as tall as the picture',
        tall.wrapMatchesPicture);
  check('the marker lands where it says it is, down a picture taller than the pane',
        Math.abs(tall.down - tall.want.down) < 0.02,
        `declared ${(tall.want.down * 100).toFixed(1)}%, drawn at ${(tall.down * 100).toFixed(1)}%`);
  check('and across it',
        Math.abs(tall.across - tall.want.across) < 0.02);

  // Two steps can now legitimately point at the same screenshot: the engine
  // writes one file when consecutive captures are identical. s1 and s3 share
  // one in this fixture, and neither has been edited - so the <img> is handed
  // the src it already has, which fires no load event.
  const twins = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ind = document.getElementById('indicator');
    const drawn = async (id) => {
      document.querySelector('#step-list li[data-id="' + id + '"]').click();
      await sleep(300);
      const mark = ind.querySelector('.bsr-marker');
      const box = mark ? mark.getBoundingClientRect() : null;
      return Boolean(box) && box.width > 8 && ind.style.display === 'block';
    };
    const out = { first: await drawn('s1'), second: await drawn('s3') };
    // Put the selection back where the rest of this section expects it.
    document.querySelector('#step-list li[data-id="s2"]').click();
    await sleep(300);
    return out;
  })()`);

  check('the click is marked on the first of two steps sharing a picture',
        twins.first);
  check('and on the second, which is handed a src it already has',
        twins.second);

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
  if (Math.abs(nudge.x - 150) > 2) console.log('    nudge:', JSON.stringify(nudge));
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

    // What is under the group. Opened by hovering, which is how a person opens
    // it - and the group itself is greyed when everything under it is, so a
    // menu can never offer a way in to three unavailable choices.
    const group = [...menu.querySelectorAll('button')]
      .find((b) => /The click marker/.test(b.textContent));
    const groupDisabled = group ? group.disabled : null;
    if (group) group.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(80);
    const markerItems = [...document.querySelectorAll('#context-sub button')]
      .map((b) => ({ label: b.textContent, disabled: b.disabled }));
    const subBox = document.getElementById('context-sub').getBoundingClientRect();
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
             items, markerItems, groupDisabled,
             subOnScreen: subBox.width > 0
               && subBox.right <= window.innerWidth
               && subBox.bottom <= window.innerHeight };
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
  check('the marker keeps its own group', shotMenu.groupDisabled === false,
        shotMenu.items.map((i) => i.label).join(' | '));
  check('and the submenu opens on screen', shotMenu.subOnScreen);
  check('and the one thing only reachable here',
        shotMenu.markerItems.some((i) => /marker back/.test(i.label) && !i.disabled),
        shotMenu.markerItems.map((i) => i.label).join(' | '));

  const reset = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const r = shot.getBoundingClientRect();
    [...document.querySelectorAll('#context button')]
      .find((b) => /The click marker/.test(b.textContent))
      .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await sleep(80);
    [...document.querySelectorAll('#context-sub button')]
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

  check('choosing an item under a group closes the menu', reset.closed);
  check('putting it back sends nothing rather than a position',
        reset.sent.at === null);
  check('and the marker returns to where the recording put it',
        Math.abs(reset.x - 300) <= 2 && Math.abs(reset.y - 200) <= 2);
  check('and stops calling itself moved', !reset.moved);

  // Turning the marker off, so somebody can draw their own arrow instead.
  const hide = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const shot = document.getElementById('shot');
    const r = shot.getBoundingClientRect();

    document.getElementById('shot-wrap').dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 150 }));
    await sleep(80);
    // The marker's own items live under one group now: "delete this arrow" and
    // "point the arrow the way it chooses" were five lines apart in the same
    // menu and meant different arrows.
    const openMarker = async () => {
      [...document.querySelectorAll('#context button')]
        .find((b) => /The click marker/.test(b.textContent))
        .dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await sleep(80);
    };
    await openMarker();
    const labelWhenShown = [...document.querySelectorAll('#context-sub button')]
      .map((b) => b.textContent).find((t) => /marker on this step/.test(t)) || '';
    [...document.querySelectorAll('#context-sub button')]
      .find((b) => /Hide the marker/.test(b.textContent)).click();
    await sleep(250);

    const gone = !document.querySelector('#indicator .bsr-marker');

    // And back again, from the same place in the menu.
    document.getElementById('shot-wrap').dispatchEvent(new MouseEvent('contextmenu',
      { bubbles: true, clientX: r.left + 200, clientY: r.top + 150 }));
    await sleep(80);
    await openMarker();
    const labelWhenHidden = [...document.querySelectorAll('#context-sub button')]
      .map((b) => b.textContent).find((t) => /marker on this step/.test(t)) || '';
    [...document.querySelectorAll('#context-sub button')]
      .find((b) => /Show the marker/.test(b.textContent)).click();
    await sleep(250);

    return {
      labelWhenShown, labelWhenHidden, gone,
      back: Boolean(document.querySelector('#indicator .bsr-marker')),
    };
  })()`);

  check('the menu offers to hide the marker', /Hide the marker/.test(hide.labelWhenShown));
  check('and hiding it takes it off the screenshot', hide.gone);
  // The same item, saying the opposite thing - not a second item that appears.
  check('the item then offers to show it', /Show the marker/.test(hide.labelWhenHidden));
  check('and it comes back', hide.back);

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
        rowMenu.items.some((t) => /note/i.test(t))
        && rowMenu.items.some((t) => /heading/i.test(t)),
        rowMenu.items.join(' | '));
  // The three the toolbar used to carry, now that + Note, + Section and
  // + Photo have gone from the window.
  check('and photographs, which used to need a button of their own',
        rowMenu.items.some((t) => /photograph/i.test(t)),
        rowMenu.items.join(' | '));
  check('and it can re-record the step',
        rowMenu.items.some((t) => /re-record/i.test(t)),
        rowMenu.items.join(' | '));
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
  check('and shows the current chord', /Ctrl.*Shift.*F9/.test(rebind.before),
        rebind.before);
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

    // Back to the library the way a person gets there: the Recordings menu.
    const goHome = async () => {
      document.getElementById('btn-recordings').click();
      await sleep(100);
      const item = [...document.querySelectorAll('#context button')]
        .find((b) => /Your recordings/.test(b.textContent));
      if (item) item.click();
      await sleep(250);
    };
    await goHome();
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
    // Back to the library the way a person gets there: the Recordings menu.
    const goHome = async () => {
      document.getElementById('btn-recordings').click();
      await sleep(100);
      const item = [...document.querySelectorAll('#context button')]
        .find((b) => /Your recordings/.test(b.textContent));
      if (item) item.click();
      await sleep(250);
    };

    // Offered while a recording is open, which is when it is needed.
    document.getElementById('btn-recordings').click();
    await sleep(100);
    const item = [...document.querySelectorAll('#context button')]
      .find((b) => /Your recordings/.test(b.textContent));
    const wasOffered = Boolean(item) && !item.disabled;
    document.getElementById('context').hidden = true;
    await sleep(50);

    await goHome();

    const showing = !document.getElementById('detail-empty').hidden
                 && document.getElementById('detail-body').hidden;
    // Once you are there, the way back is offered greyed rather than doing
    // nothing when clicked.
    document.getElementById('btn-recordings').click();
    await sleep(100);
    const there = [...document.querySelectorAll('#context button')]
      .find((b) => /Your recordings/.test(b.textContent));
    const greyed = Boolean(there) && there.disabled;
    document.getElementById('context').hidden = true;

    return {
      wasOffered, showing, greyed,
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
    document.getElementById('btn-recordings').click();
    await sleep(100);
    const way = [...document.querySelectorAll('#context button')]
      .find((b) => /Your recordings/.test(b.textContent));
    const offered = Boolean(way) && !way.disabled;
    document.getElementById('context').hidden = true;
    return { showing: !document.getElementById('detail-body').hidden, offered };
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

  // ---- the start hotkey ----------------------------------------------------
  // Reported as "the hotkeys will not change": the key was pressed expecting a
  // recording to start, nothing happened, and a silent hotkey is
  // indistinguishable from a broken one.
  console.log('\nstarting from the hotkey:');

  const idle = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.bsr.__hotkey({ action: 'idle' });
    await sleep(150);
    const notice = document.getElementById('notice');
    return { hidden: notice.hidden,
             said: document.getElementById('notice-text').textContent };
  })()`);

  check('a hotkey with nothing to act on says so', !idle.hidden);
  check('and says what to do instead', /Nothing is being recorded/.test(idle.said));

  const started = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    await window.bsr.__hotkey({ action: 'started', session: {
      ok: true, dir: 'C:/fake/session-2', scope: 'Google Chrome',
      name: 'Hotkey recording', purpose: 'sop',
    } });
    await sleep(200);
    return {
      state: document.getElementById('status-text').textContent,
      scope: document.getElementById('btn-scope').textContent,
      name: document.getElementById('session-name').value,
      said: document.getElementById('notice-text').textContent,
      stopEnabled: !document.getElementById('btn-stop').disabled,
      steps: document.querySelectorAll('#step-list li.step').length,
    };
  })()`);

  // The window was idle and a recording began without it: if it does not keep
  // up, it sits there claiming to be idle while the engine records.
  check('the window catches up with a recording it did not start',
        /Recording/i.test(started.state));
  check('Stop becomes available', started.stopEnabled);
  check('the scope it chose is shown', /Google Chrome/.test(started.scope));
  check('and the recording is named', started.name === 'Hotkey recording');
  check('with the previous recording cleared out', started.steps === 0);
  // Scoping to the foreground application is a decision made for the user, so
  // it has to be said out loud rather than discovered in the export.
  check('it says what it is recording', /Google Chrome/.test(started.said));

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
