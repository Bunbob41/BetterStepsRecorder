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

const shot = {
  point: { x: 300, y: 200 }, frame: { x: 0, y: 0, w: 600, h: 400 },
  window: { title: 'App', process: 'app.exe', rect: { x: 0, y: 0, w: 600, h: 400 } },
  screenshot: 'steps/0001.png',
};

const SESSION = {
  ok: true, dir: 'C:/fake/session-1', name: 'Window test',
  steps: [
    { id: 's1', action: 'leftClick', text: 'Click the "New" button', ...shot },
    { id: 's2', action: 'leftClick', text: 'Click Save, then Save again', ...shot },
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

const ANSWERS = {
  getSettings: () => ({ markerStyle: 'circle', markerBold: false,
                        highlightColour: 'yellow', showHighlightLegend: false,
                        highlightMeanings: {}, captureFormat: 'png' }),
  getShortcuts: () => ({}),
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
  listTemplates: () => ({ templates: [] }),
  effectiveTemplate: () => ({ name: '' }),
  getBuild: () => ({ version: '0', build: 0, commit: 'test', source: 'dev' }),
  // A 1x1 transparent GIF: the screenshot never has to decode, because every
  // measurement the drag makes comes from the <img> element's box, which the
  // test sizes explicitly.
  shotUrl: () => SHOT,
  // A real image at a real size. Returning null here sent every completed drag
  // into alert('Could not read the screenshot.') - a modal that never resolves
  // in a hidden window, and a run that never ended. It also meant the marking
  // path was never actually reached.
  shotData: () => SHOT,
  updateStep: () => ({ ok: true }),
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

  const win = new BrowserWindow({
    width: 1280, height: 900, show: false,
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

  // ---- searching every recording -------------------------------------------
  console.log('\nsearching the whole archive:');

  const arch = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const q = document.getElementById('library-query');

    // Back to the library screen first.
    document.getElementById('detail-empty').hidden = false;
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
