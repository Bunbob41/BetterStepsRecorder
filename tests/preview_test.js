/**
 * The drag preview, exercised in a real window.
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
 *   npx electron tests/preview_test.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RENDERER = path.join(__dirname, '..', 'ui', 'src', 'renderer');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

/** Everything the page asks the main process for, answered plausibly. */
const PRELOAD = `
const { contextBridge } = require('electron');

const SESSION = {
  ok: true, dir: 'C:/fake/session-1', name: 'Preview test',
  steps: [{
    id: 's1', action: 'leftClick', text: 'Click the "New" button',
    point: { x: 300, y: 200 }, frame: { x: 0, y: 0, w: 600, h: 400 },
    window: { title: 'App', process: 'app.exe', rect: { x: 0, y: 0, w: 600, h: 400 } },
    screenshot: 'steps/0001.png',
  }],
};

const ANSWERS = {
  getSettings: () => ({ markerStyle: 'circle', markerBold: false,
                        highlightColour: 'yellow', showHighlightLegend: false,
                        highlightMeanings: {}, captureFormat: 'png' }),
  getShortcuts: () => ({}),
  getScope: () => ({ pids: [], label: 'Everything' }),
  getSession: () => SESSION,
  openLibrary: () => SESSION,
  listLibrary: () => [{ dir: SESSION.dir, name: 'Preview test', steps: 1, savedAt: null }],
  listTemplates: () => ({ templates: [] }),
  effectiveTemplate: () => ({ name: '' }),
  getBuild: () => ({ version: '0', build: 0, commit: 'test', source: 'dev' }),
  // A 1x1 transparent GIF: the screenshot never has to decode, because every
  // measurement the drag makes comes from the <img> element's box, which the
  // test sizes explicitly.
  shotUrl: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
  shotData: () => null,
  updateStep: () => ({ ok: true }),
  redactStep: () => ({ ok: true, steps: SESSION.steps }),
};

// A plain object, built from the names the real preload exposes. contextBridge
// refuses a Proxy ("An object could not be cloned"), and taking the names from
// preload.js rather than a list here means the stub cannot drift away from the
// surface the page actually has.
const bridge = {};
for (const name of NAMES) {
  bridge[name] = name.startsWith('on')
    ? () => {}
    : async (...args) => (ANSWERS[name] ? ANSWERS[name](...args) : { ok: true });
}
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
const watchdog = setTimeout(() => {
  console.log('\nTIMED OUT - the run never reached the end');
  app.exit(2);
}, 90000);

app.whenReady().then(async () => {
  const preloadPath = path.join(os.tmpdir(), `bsr-preview-preload-${Date.now()}.js`);
  fs.writeFileSync(preloadPath,
    `const NAMES = ${JSON.stringify(bridgeNames())};\n` + PRELOAD);

  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  });

  const errors = [];
  win.webContents.on('console-message', (_e, level, message) => {
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

  // The original defect was a ReferenceError, which is invisible to every
  // assertion above if it happens to leave the page in a passable state.
  console.log('\nthe page ran clean:');
  check('no errors on the console', errors.length === 0);
  if (errors.length) for (const e of errors.slice(0, 5)) console.log('    ' + e);

  fs.rmSync(preloadPath, { force: true });
  clearTimeout(watchdog);
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
