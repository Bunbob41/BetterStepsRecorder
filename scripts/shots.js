/**
 * The README's screenshots, generated rather than taken by hand.
 *
 *   npm run shots        (from ui/)
 *
 * The four images in docs/images were captured by hand in September and were
 * six UI changes out of date within the week: they showed a toolbar with
 * separate Recordings and Open buttons, a Pause and a Stop that have since been
 * removed, and "Idle" where the status line now names what is open. A picture
 * of the product is documentation, and documentation nobody can regenerate is
 * documentation that rots.
 *
 * So this runs the REAL page - the real index.html, renderer.js and stylesheet -
 * against a stubbed bridge, and captures it with `capturePage()`. Re-run it
 * whenever the window changes and the README catches up in one command.
 *
 * What it does NOT do is record anything. The recording it shows is fiction:
 * a made-up application, made-up steps, and screenshots drawn by this script.
 * Real recordings on this machine are somebody's actual work - and this repo is
 * public, so they are exactly what must not end up in it.
 *
 * No input is synthesized at the operating system and no window outside this
 * process is touched or photographed.
 */
const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'ui', 'src', 'renderer');
const OUT = path.join(ROOT, 'docs', 'images');

// The window the screenshots are taken at. Wide enough that the toolbar is not
// wrapping and the step list and the picture both have room, which is the shape
// somebody actually works in.
const W = 1360;
const H = 900;

// The application being documented. Invented on purpose: a screenshot in a
// public README should not put a real vendor's product - or a customer's data -
// in front of people who never agreed to it.
const APP = 'Meridian Sensor Setup';
const PROC = 'Meridian.exe';
const SHOT = { w: 940, h: 620 };

// ---------------------------------------------------------------------------
// The recording, as fiction

/**
 * tab, the control that was used, and where in the dialog it sits.
 *
 * The points are measured against the layout below, not guessed: the click
 * marker is placed from them, and a marker beside the control rather than on it
 * is the one thing in a screenshot of this application that would be read as a
 * bug in it.
 */
const SCRIPT = [
  { tab: 'calibration', point: [169, 70],
    text: `Clicked the "Calibration" tab in "${APP}"`,
    target: { name: 'Calibration', controlType: 'TabItem' } },
  { tab: 'calibration', focus: 'sensor', point: [640, 171],
    text: `Clicked the "Sensor type" dropdown in "${APP}"`,
    target: { name: 'Sensor type', controlType: 'ComboBox' } },
  { tab: 'calibration', focus: 'sensor', open: 'sensor', point: [476, 240],
    text: 'Clicked "Depth (dual frequency)" in "Sensor type"',
    target: { name: 'Depth (dual frequency)', controlType: 'ListItem' } },
  { tab: 'calibration', focus: 'offset', point: [476, 221], action: 'keyPress',
    text: 'Typed "1.42" into "Transducer offset (m)"',
    target: { name: 'Transducer offset (m)', controlType: 'Edit' } },
  { tab: 'calibration', focus: 'rate', point: [640, 311],
    text: `Clicked the "Sample rate" dropdown in "${APP}"`,
    target: { name: 'Sample rate', controlType: 'ComboBox' } },
  { tab: 'logging', point: [275, 70],
    text: `Clicked the "Logging" tab in "${APP}"`,
    target: { name: 'Logging', controlType: 'TabItem' } },
  { tab: 'logging', focus: 'raw', point: [55, 163],
    text: 'Ticked "Write a raw log alongside"',
    target: { name: 'Write a raw log alongside', controlType: 'CheckBox' } },
  { tab: 'logging', focus: 'apply', point: [774, 570],
    text: `Clicked "Apply" in "${APP}"`,
    target: { name: 'Apply', controlType: 'Button' } },
];

/**
 * The application being recorded, drawn rather than photographed.
 *
 * Deliberately generic: a plain Windows-shaped dialog with tabs and fields. It
 * has to look like something worth documenting without looking like anybody's
 * actual product.
 */
function dialogHtml({ tab, focus, open }) {
  const on = (t) => (t === tab ? ' class="on"' : '');
  const ring = (f) => (f === focus ? ' focused' : '');
  const field = (id, label, value, kind = 'select') => `
    <div class="row">
      <label>${label}</label>
      ${kind === 'select'
        ? `<div class="control select${ring(id)}"><span>${value}</span><i>⌄</i></div>`
        : `<div class="control text${ring(id)}"><span>${value}</span></div>`}
    </div>`;

  return `<!doctype html><meta charset="utf-8"><style>
  * { box-sizing: border-box; }
  body { margin: 0; width: ${SHOT.w}px; height: ${SHOT.h}px; overflow: hidden;
         font: 14px/1.4 "Segoe UI", system-ui, sans-serif; color: #1b1b1b;
         background: #f3f3f3; }
  .bar { height: 40px; display: flex; align-items: center; gap: 10px;
         padding: 0 12px; background: #fff; border-bottom: 1px solid #e2e2e2; }
  .glyph { width: 18px; height: 18px; border-radius: 4px;
           background: linear-gradient(140deg, #4c8dff, #2f6ad9); }
  .bar b { font-weight: 600; font-size: 14px; }
  .bar .win { margin-left: auto; color: #6a6a6a; letter-spacing: 6px; }
  .tabs { display: flex; gap: 2px; padding: 12px 18px 0; background: #f3f3f3; }
  .tabs div { padding: 9px 20px; border: 1px solid #dcdcdc; border-bottom: 0;
              border-radius: 6px 6px 0 0; background: #eaeaea; color: #444; }
  .tabs div.on { background: #fff; color: #111; font-weight: 600; }
  .panel { margin: 0 18px 18px; padding: 26px 28px; background: #fff;
           border: 1px solid #dcdcdc; height: 448px; }
  h2 { margin: 0 0 20px; font-size: 15px; font-weight: 600; }
  .row { display: flex; align-items: center; margin-bottom: 18px; }
  label { width: 240px; color: #333; }
  .control { flex: 1; max-width: 380px; height: 32px; padding: 0 10px;
             display: flex; align-items: center; background: #fff;
             border: 1px solid #b9b9b9; border-radius: 3px; }
  .control i { margin-left: auto; font-style: normal; color: #555; }
  .control.focused { border-color: #0067c0; box-shadow: 0 0 0 2px #cce4f7; }
  .check { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  .box { width: 17px; height: 17px; border: 1px solid #b9b9b9; border-radius: 3px;
         background: #fff; }
  .check.focused .box { border-color: #0067c0; background: #0067c0; }
  .check.focused .box::after { content: "✓"; color: #fff; font-size: 12px;
                               display: block; text-align: center; line-height: 15px; }
  .hint { color: #6a6a6a; font-size: 12.5px; margin: -8px 0 20px 250px; }
  /* An open dropdown. Worth drawing: a menu that stands open over the window is
     exactly the thing this recorder captures in place, and a screenshot of the
     product should show it doing so. */
  .menu { position: absolute; left: 286px; top: 187px; width: 380px;
          background: #fff; border: 1px solid #b9b9b9; border-radius: 3px;
          box-shadow: 0 8px 18px rgba(0,0,0,.16); z-index: 5; }
  .menu div { height: 34px; display: flex; align-items: center; padding: 0 10px; }
  .menu div.pick { background: #cce4f7; }
  .actions { display: flex; justify-content: flex-end; gap: 10px;
             margin: 0 18px; }
  .actions button { min-width: 92px; height: 30px; border-radius: 3px;
                    border: 1px solid #b9b9b9; background: #fdfdfd; font: inherit; }
  .actions button.primary { background: #0067c0; border-color: #0067c0; color: #fff; }
  .actions button.focused { box-shadow: 0 0 0 2px #cce4f7; }
  </style>
  <div class="bar"><span class="glyph"></span><b>${APP}</b><span class="win">—□✕</span></div>
  <div class="tabs">
    <div${on('general')}>General</div>
    <div${on('calibration')}>Calibration</div>
    <div${on('logging')}>Logging</div>
    <div${on('advanced')}>Advanced</div>
  </div>
  <div class="panel">
  ${tab === 'logging' ? `
    <h2>Logging</h2>
    <div class="check${ring('raw')}"><span class="box"></span>
      <span>Write a raw log alongside</span></div>
    <div class="check"><span class="box"></span><span>Timestamp every record</span></div>
    ${field('folder', 'Log folder', 'D:\\\\Surveys\\\\2026\\\\Logs', 'text')}
    ${field('rollover', 'Start a new file', 'Every 6 hours')}
  ` : `
    <h2>Calibration</h2>
    ${field('sensor', 'Sensor type', 'Depth (dual frequency)')}
    ${field('offset', 'Transducer offset (m)', '1.42', 'text')}
    <div class="hint">Measured from the waterline to the transducer face.</div>
    ${field('rate', 'Sample rate', '10 Hz')}
    ${field('filter', 'Spike filter', 'Moderate')}
    ${open === 'sensor' ? `
      <div class="menu">
        <div>Depth (single frequency)</div>
        <div class="pick">Depth (dual frequency)</div>
        <div>Sound velocity</div>
      </div>` : ''}
  `}
  </div>
  <div class="actions">
    <button>Cancel</button>
    <button class="${'focused' === ring('apply').trim() ? 'focused' : ''}">Apply</button>
    <button class="primary">OK</button>
  </div>`;
}

// ---------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Draws the fictional application and saves it as a step's screenshot. */
async function drawShots(dir) {
  const win = new BrowserWindow({
    width: SHOT.w, height: SHOT.h, show: false,
    webPreferences: { offscreen: false },
  });

  const steps = [];
  for (let i = 0; i < SCRIPT.length; i++) {
    const s = SCRIPT[i];
    await win.loadURL('data:text/html;charset=utf-8,'
                      + encodeURIComponent(dialogHtml(s)));
    await sleep(120);
    const img = await win.webContents.capturePage();

    const rel = `steps/${String(i + 1).padStart(4, '0')}.png`;
    fs.writeFileSync(path.join(dir, rel), img.toPNG());

    // The picture comes back at the display's scaling, not at the size the
    // dialog was laid out in, so the frame is read off the picture rather than
    // assumed. The click marker is placed as a percentage of the frame, and the
    // step line prints these numbers - a frame that disagrees with the picture
    // would put the marker in the right place for the wrong reason and print a
    // size the picture is not.
    const size = img.getSize();
    const k = size.width / SHOT.w;

    steps.push({
      v: 1, type: 'step',
      id: `fixture-${i + 1}`,
      seq: i + 1,
      ts: new Date(Date.UTC(2026, 8, 12, 9, 14 + i * 2, 5)).toISOString(),
      action: s.action || 'leftClick',
      point: { x: Math.round(s.point[0] * k), y: Math.round(s.point[1] * k) },
      monitor: { index: 0, scale: 1 },
      window: { title: APP, process: PROC, product: 'Meridian',
                rect: { x: 0, y: 0, w: size.width, h: size.height } },
      frame: { x: 0, y: 0, w: size.width, h: size.height },
      target: s.target,
      screenshot: rel,
      text: s.text,
    });
  }

  win.destroy();
  return steps;
}

/** The bridge the page talks to, answered from the fixture. */
function preloadSource(session) {
  const names = [...fs.readFileSync(path.join(ROOT, 'ui/src/main/preload.js'), 'utf8')
    .matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
  if (names.length < 20) throw new Error('preload surface not recognised');

  const settings = {
    saveRoot: 'D:\\Surveys\\2026\\Recordings',
    imageFormat: 'png', imageQuality: 85, imageScale: 1, imageFrame: 'window',
    recordKeyboard: true, markerStyle: 'circle', markerBold: false,
    highlightColour: 'yellow', showHighlightLegend: false, highlightMeanings: {},
    brandName: '', brandLogo: '', brandFooter: '', templatePath: '',
    stepsCollapsed: false, stepsWidth: 340, showClickMarker: true,
    hotkeyPause: 'Ctrl+Shift+F9', hotkeyStop: 'Ctrl+Shift+F10',
  };

  // Where the recording would live on the machine of somebody using this. The
  // fixture actually sits in a temp folder, and the window prints the path it
  // is given along the bottom - a screenshot in a public README should not
  // carry the build machine's temp directory across it.
  const shown = 'D:\\Surveys\\2026\\Recordings\\session-2026-09-12T09-14-05-000Z';

  // The times are printed in the local zone of whoever runs this, so they are
  // set late enough in the day to read as working hours across the Americas and
  // Europe rather than as somebody calibrating a sensor at two in the morning.
  const library = [
    { dir: shown, name: session.name, app: 'Meridian',
      steps: session.steps.length, savedAt: '2026-09-12T16:31:00Z' },
    { dir: 'D:/Surveys/2026/Recordings/session-2026-09-09', name: 'Daily start-up checks',
      app: 'Meridian', steps: 14, savedAt: '2026-09-09T14:02:00Z' },
    { dir: 'D:/Surveys/2026/Recordings/session-2026-09-04', name: 'Exporting a survey line',
      app: 'Meridian', steps: 23, savedAt: '2026-09-04T18:48:00Z' },
    { dir: 'D:/Surveys/2026/Recordings/session-2026-08-28', name: 'Replacing a transducer',
      app: 'Meridian', steps: 9, savedAt: '2026-08-28T17:20:00Z' },
  ];

  const opened = {
    ok: true, dir: shown, name: session.name, steps: session.steps,
    purpose: 'sop', templatePath: '',
  };

  return `
const { contextBridge, ipcRenderer } = require('electron');
const NAMES = ${JSON.stringify(names)};
const SETTINGS = ${JSON.stringify(settings)};
const LIBRARY = ${JSON.stringify(library)};
const OPENED = ${JSON.stringify(opened)};
const SHOTDIR = ${JSON.stringify(session.dir.replace(/\\/g, '/'))};

const ANSWERS = {
  getSettings: () => ({ ...SETTINGS }),
  setSettings: (patch) => Object.assign(SETTINGS, patch || {}) && { ...SETTINGS },
  getScope: () => ({ pids: [], label: 'Everything' }),
  listLibrary: () => LIBRARY,
  libraryUsage: () => ({ ok: true, root: SETTINGS.saveRoot, bytes: 412 * 1024 * 1024,
                         recordings: LIBRARY.length }),
  openLibrary: () => OPENED,
  shotUrl: (rel) => 'bsr://shot/' + String(rel || '').replace(/^steps\\//, ''),
  getShortcuts: () => ({ pause: SETTINGS.hotkeyPause, stop: SETTINGS.hotkeyStop,
                         pauseActive: true, stopActive: true,
                         defaults: { pause: 'Ctrl+Shift+F9', stop: 'Ctrl+Shift+F10' } }),
  listTemplates: () => ({ ok: true, templates: [] }),
  effectiveTemplate: () => ({ path: '', chosen: false }),
  getBuild: () => ({ version: '0.2.3', build: 135, commit: 'e028dd0', source: 'packaged' }),
  listWindows: () => ({ ok: true, windows: [] }),
};

const bridge = {};
for (const name of NAMES) {
  bridge[name] = name.startsWith('on')
    ? () => {}
    : async (...args) => (ANSWERS[name] ? ANSWERS[name](...args) : { ok: true });
}
contextBridge.exposeInMainWorld('bsr', bridge);
`;
}

// ---------------------------------------------------------------------------

app.disableHardwareAcceleration();

// The drawing window is destroyed before the real one is made, and with no
// window open Electron's default is to quit - which cancelled the next load and
// reported it as the page failing to load, which is not what happened.
app.on('window-all-closed', () => {});

// Before ready, exactly as the application does it: the page loads its
// screenshots over bsr://, and the scheme has to be standard and secure or the
// content policy refuses them.
protocol.registerSchemesAsPrivileged([
  { scheme: 'bsr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

app.whenReady().then(main).catch((err) => {
  console.log('FAILED: ' + (err && err.stack || err));
  app.exit(1);
});

async function main() {
  fs.mkdirSync(OUT, { recursive: true });

  const bench = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-shots-'));
  const dir = path.join(bench, 'session-2026-09-12T09-14-05-000Z');
  fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });

  console.log('drawing the application being documented...');
  const steps = await drawShots(dir);
  const session = { dir, name: 'Calibrating a depth sensor', steps };
  fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify({
    v: 1, name: session.name, purpose: 'sop', templatePath: '',
    scope: { label: 'Meridian', processes: [PROC] }, shotSeq: steps.length,
    savedAt: '2026-09-12T09:31:00Z', steps,
  }, null, 2), 'utf8');

  // The page's own scheme, served out of the fixture folder.
  protocol.handle('bsr', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname).replace(/^\//, '');
    const file = path.join(dir, 'steps', path.basename(name));
    if (!fs.existsSync(file)) return new Response('', { status: 404 });
    return new Response(fs.readFileSync(file), { headers: { 'content-type': 'image/png' } });
  });

  // Its own folder with a package.json: Node resolves a module by walking up
  // looking for one, and an unrelated malformed package.json in temp has
  // stopped a preload loading here before.
  const preDir = path.join(bench, 'preload');
  fs.mkdirSync(preDir, { recursive: true });
  fs.writeFileSync(path.join(preDir, 'package.json'), '{"type":"commonjs"}');
  const preloadPath = path.join(preDir, 'preload.js');
  fs.writeFileSync(preloadPath, preloadSource(session));

  const win = new BrowserWindow({
    width: W, height: H, show: false, backgroundColor: '#131519',
    webPreferences: { preload: preloadPath, contextIsolation: true,
                      nodeIntegration: false, sandbox: false },
  });
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2) console.log('  page error: ' + message);
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log(`  did-fail-load ${code} ${desc} ${url}`);
  });
  win.webContents.on('preload-error', (_e, file, err) => {
    console.log(`  preload-error in ${file}: ${err && err.message}`);
  });
  win.webContents.on('render-process-gone', (_e, details) => {
    console.log(`  render process gone: ${JSON.stringify(details)}`);
  });

  await win.loadFile(path.join(RENDERER, 'index.html'));
  await sleep(700);

  const shot = async (name, note) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log(`  ${name}  ${note}`);
  };

  console.log('capturing the window...');
  await shot('library.png', 'the recordings you already have');

  // Open the recording and select a step, the way a person does.
  await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector('#library-list .lib-row').click();
    await sleep(500);
    // The step with the dropdown standing open: it shows the click marker on
    // the option that was chosen, and shows the recorder catching a menu in
    // place, which is the behaviour hardest to believe without seeing it.
    const rows = document.querySelectorAll('#step-list li.step');
    rows[2].click();
    await sleep(500);
  })()`);
  await sleep(400);
  if (process.env.BSR_SHOTS_DEBUG) {
    console.log('  indicator: ' + await win.webContents.executeJavaScript(`
      (() => {
        const i = document.getElementById('indicator');
        const s = document.getElementById('shot');
        return JSON.stringify({
          hidden: i.hidden, html: i.innerHTML.slice(0, 120),
          rect: i.getBoundingClientRect().toJSON(),
          shot: { w: s.naturalWidth, h: s.naturalHeight, src: s.src.slice(0, 60) },
        });
      })()`));
  }
  await shot('hero.png', 'a recording open, with the click marked');

  await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.getElementById('btn-settings').click();
    await sleep(400);
  })()`);
  await sleep(300);
  await shot('settings.png', 'where the recordings go, and what they look like');

  win.destroy();

  // The same recording, exported. Built with the real exporter rather than
  // mocked up, so the picture cannot promise a document the code does not
  // produce - and so it shows the same procedure the hero does, instead of a
  // different recording from a different month.
  console.log('exporting the same recording...');
  const { buildHtml } = require(path.join(ROOT, 'ui/src/main/export.js'));
  const { Session } = require(path.join(ROOT, 'ui/src/main/session.js'));
  const loaded = Session.load(dir);
  const html = buildHtml(loaded, {
    title: session.name, embedImages: true, voice: 'imperative',
    markerOpts: { style: 'circle', bold: false, show: true },
  });
  const htmlFile = path.join(bench, 'guide.html');
  fs.writeFileSync(htmlFile, html, 'utf8');

  // The guide's stylesheet is light with a dark override for a reader whose
  // machine asks for one. Captured light: that is its default, it is what the
  // print rule produces, and it is what a document being handed to somebody
  // looks like. Left to the machine, this picture would show whichever theme
  // the build box happened to be in.
  require('electron').nativeTheme.themeSource = 'light';

  const doc = new BrowserWindow({
    width: 1100, height: 980, show: false, backgroundColor: '#ffffff',
  });
  await doc.loadFile(htmlFile);
  await sleep(600);
  fs.writeFileSync(path.join(OUT, 'exported-guide.png'),
                   (await doc.webContents.capturePage()).toPNG());
  console.log('  exported-guide.png  what somebody else receives');
  doc.destroy();

  fs.rmSync(bench, { recursive: true, force: true });
  console.log(`\nwritten to ${path.relative(ROOT, OUT)}`);
  app.exit(0);
}
