const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, globalShortcut } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Sidecar } = require('./sidecar');
const { Session } = require('./session');
const { Settings } = require('./settings');
const log = require('./log');
const { buildHtml, buildMarkdown, copyImages } = require('./export');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let win = null;
let sidecar = null;
let session = null;
let settings = null;

// Scope chosen for the next recording: [] means everything.
let scopePids = [];
let scopeLabel = 'Everything';
let recordingPaused = false;

// Chosen to avoid colliding with anything common. Ctrl+Shift+F9/F10 are not
// used by Office, browsers or the shell.
const HOTKEY_PAUSE = 'Control+Shift+F9';
const HOTKEY_STOP = 'Control+Shift+F10';

// Screenshots live outside the app directory, so a custom protocol serves them
// instead of loosening webSecurity for the whole renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'bsr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#16171b',
    title: 'Steps Recorder',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function wireSidecar() {
  sidecar = new Sidecar();

  sidecar.on('ready', (m) => send('sidecar:ready', m));
  sidecar.on('log', (m) => send('sidecar:log', m));
  sidecar.on('error', (m) => send('sidecar:error', m));

  sidecar.on('step', (step) => {
    if (!session) return;

    if (step.replaces) {
      const swapped = session.replaceStep(step.replaces, step);
      if (swapped) {
        send('session:replaced', swapped);
        send('session:saved', { dir: session.dir, count: session.steps.length });
      }
      return;
    }

    const result = session.addStep(step);
    send('session:step', result);
    send('session:saved', { dir: session.dir, count: session.steps.length });
  });

  sidecar.on('exit', (code) => send('sidecar:exit', { code }));
}

process.on('uncaughtException', (err) => log.error(err));
process.on('unhandledRejection', (err) => log.error(err));

app.whenReady().then(() => {
  // bsr://step/<encoded absolute path> -> that file, and nothing outside the
  // active session directory.
  protocol.handle('bsr', (request) => {
    const url = new URL(request.url);
    const target = path.normalize(decodeURIComponent(url.pathname.replace(/^\//, '')));

    if (!session || !target.startsWith(path.normalize(session.dir))) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).href);
  });

  log.init(app.getPath('userData'));
  registerHotkeys();
  settings = new Settings(app.getPath('userData'));
  log.info(`settings: ${JSON.stringify(settings.values)}`);
  wireSidecar();
  createWindow();
});

/**
 * Pause and stop have to work while another application is in front, because
 * that is where the user is during a recording. Making them hunt for this
 * window mid-flow puts the hunt into the guide they are recording.
 */
function registerHotkeys() {
  const paused = globalShortcut.register(HOTKEY_PAUSE, () => {
    if (!sidecar || !sidecar.running) return;
    recordingPaused = !recordingPaused;
    if (recordingPaused) sidecar.pause(); else sidecar.resume();
    log.info(`hotkey: ${recordingPaused ? 'paused' : 'resumed'}`);
    send('hotkey', { action: recordingPaused ? 'paused' : 'resumed' });
  });

  const stopped = globalShortcut.register(HOTKEY_STOP, () => {
    if (!sidecar || !sidecar.running) return;
    recordingPaused = false;
    sidecar.stop();
    log.info('hotkey: stopped');
    send('hotkey', { action: 'stopped' });
  });

  if (!paused || !stopped) {
    // Another application already owns the combination; the buttons still work.
    log.warn(`hotkey registration failed (pause=${paused}, stop=${stopped})`);
  }
}

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (sidecar) sidecar.stop();
  app.quit();
});

// A global mouse hook must never outlive the UI.
app.on('before-quit', () => { if (sidecar) sidecar.stop(); });
process.on('exit', () => { if (sidecar) sidecar.kill(); });

// ---- renderer API -----------------------------------------------------------

async function ensureSidecar() {
  if (sidecar.running) return { ok: true };

  const exe = Sidecar.resolveExe(PROJECT_ROOT);
  if (!exe) {
    return { ok: false, error: 'Capture engine not found. Build it with: dotnet build capture' };
  }

  sidecar.start(exe);
  await new Promise((resolve) => {
    sidecar.once('ready', resolve);
    setTimeout(resolve, 4000);   // don't hang the UI if the engine is wedged
  });
  return { ok: true };
}

ipcMain.handle('recording:start', async () => {
  log.info('recording:start invoked');
  const exe = Sidecar.resolveExe(PROJECT_ROOT);
  log.info(`capture engine: ${exe}`);
  if (!exe) {
    return { ok: false, error: 'Capture engine not found. Build it with: dotnet build capture' };
  }

  const writable = settings.probe();
  if (!writable.ok) {
    return { ok: false, error: `Cannot write to ${settings.values.saveRoot}: ${writable.error}` };
  }

  const dir = path.join(settings.values.saveRoot,
    `session-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  log.info(`creating session at ${dir}`);
  session = new Session(dir);

  await ensureSidecar();

  // Our own process, so clicking Stop does not become the last recorded step.
  sidecar.startSession(dir, [process.pid], {
    imageFormat: settings.values.imageFormat,
    imageQuality: settings.values.imageQuality,
    imageScale: settings.values.imageScale,
    recordKeyboard: settings.values.recordKeyboard,
    allowPids: scopePids,
    // So pressing the stop hotkey is not itself the final recorded step.
    hotkeys: ['Ctrl+Shift+F9', 'Ctrl+Shift+F10'],
  });
  send('session:saved', { dir, count: 0 });
  return { ok: true, dir, scope: scopeLabel };
});

ipcMain.handle('recording:pause',  () => { recordingPaused = true;  sidecar.pause();  return { ok: true }; });
ipcMain.handle('recording:resume', () => { recordingPaused = false; sidecar.resume(); return { ok: true }; });

ipcMain.handle('recording:stop', () => {
  recordingPaused = false;
  sidecar.stop();
  return { ok: true, steps: session ? session.steps.length : 0 };
});

ipcMain.handle('session:get', () => ({
  dir: session ? session.dir : null,
  steps: session ? session.steps : [],
}));

ipcMain.handle('step:update', (_e, { id, patch }) =>
  session ? session.updateStep(id, patch) : null);

ipcMain.handle('step:remove', (_e, { id }) =>
  session ? session.removeStep(id) : false);

ipcMain.handle('step:reorder', (_e, { from, to }) =>
  session ? session.reorder(from, to) : false);

ipcMain.handle('session:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Open recording', properties: ['openDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  session = Session.load(r.filePaths[0]);
  return { ok: true, dir: session.dir, steps: session.steps };
});

/**
 * Overwrites a step's screenshot with a redacted version produced by the
 * renderer. Deliberately destructive: an overlay that merely hides the pixels
 * would leave the customer's name sitting in the session folder, and a
 * "redacted" guide whose source images still contain the data is a lie.
 */
// The renderer edits pixels on a canvas. Reading back from a canvas painted
// with a bsr:// image would taint it and make toDataURL throw, so editing
// loads the bytes as a data URL instead.
ipcMain.handle('shot:data', (_e, { screenshot }) => {
  if (!session || !screenshot) return null;
  const abs = path.join(session.dir, screenshot);
  if (!fs.existsSync(abs)) return null;
  const mime = /\.jpe?g$/i.test(abs) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
});

ipcMain.handle('step:redact', (_e, { id, dataUrl }) => {
  if (!session) return { ok: false, error: 'No recording is open.' };

  const step = session.steps.find((s) => s.id === id);
  if (!step || !step.screenshot) return { ok: false, error: 'Step not found.' };

  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) return { ok: false, error: 'Expected a PNG data URL.' };

  const file = path.join(session.dir, step.screenshot);
  const bytes = Buffer.from(match[1], 'base64');

  // Write beside the original and rename over it, so an interrupted write
  // cannot leave a truncated screenshot where a real one used to be.
  const temp = file + '.tmp';
  fs.writeFileSync(temp, bytes);
  fs.renameSync(temp, file);

  const updated = session.updateStep(id, {
    redacted: true,
    editedAt: new Date().toISOString(),
  });

  log.info(`redacted step ${id}`);
  return { ok: true, step: updated };
});

ipcMain.handle('export:run', async (_e, { format, title }) => {
  if (!session || !session.steps.length) {
    return { ok: false, error: 'Nothing to export yet.' };
  }

  const safeTitle = (title || 'Recorded steps').trim() || 'Recorded steps';
  const slug = safeTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

  const filters = {
    html: [{ name: 'Web page', extensions: ['html'] }],
    md: [{ name: 'Markdown', extensions: ['md'] }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }],
  }[format];

  const chosen = await dialog.showSaveDialog(win, {
    title: 'Export steps',
    defaultPath: path.join(settings.values.saveRoot, `${slug}.${format}`),
    filters,
  });
  if (chosen.canceled || !chosen.filePath) return { ok: false, cancelled: true };

  const out = chosen.filePath;

  try {
    if (format === 'html') {
      // Images are embedded, so the export is a single portable file rather
      // than a document that breaks the moment it is emailed on its own.
      fs.writeFileSync(out, buildHtml(session, { title: safeTitle, embedImages: true }), 'utf8');

    } else if (format === 'md') {
      const imageDir = `${path.basename(out, '.md')}-images`;
      const copied = copyImages(session, path.join(path.dirname(out), imageDir));
      fs.writeFileSync(out, buildMarkdown(session, { title: safeTitle, imageDir }), 'utf8');
      log.info(`markdown export copied ${copied} images`);

    } else if (format === 'pdf') {
      await exportPdf(safeTitle, out);
    }

    log.info(`exported ${format} to ${out}`);
    return { ok: true, file: out };

  } catch (err) {
    log.error(err);
    return { ok: false, error: err.message };
  }
});

/**
 * Renders the same HTML in an offscreen window and prints it. Reusing the HTML
 * exporter keeps one layout to maintain rather than a separate PDF renderer.
 */
async function exportPdf(title, outFile) {
  const html = buildHtml(session, { title, embedImages: true });
  const temp = path.join(app.getPath('temp'), `bsr-export-${Date.now()}.html`);
  fs.writeFileSync(temp, html, 'utf8');

  const printer = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false },
  });

  try {
    await printer.loadFile(temp);
    // Images are data URIs, so layout is settled once load resolves; this
    // small delay covers font substitution before the page is measured.
    await new Promise((r) => setTimeout(r, 300));

    const pdf = await printer.webContents.printToPDF({
      printBackground: true,
      margins: { marginType: 'custom', top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      pageSize: 'A4',
    });
    fs.writeFileSync(outFile, pdf);
  } finally {
    printer.destroy();
    try { fs.unlinkSync(temp); } catch { /* temp file, not worth failing over */ }
  }
}

ipcMain.handle('step:rerecord', async (_e, { id }) => {
  if (!session) return { ok: false, error: 'No recording is open.' };
  if (!session.steps.some((s) => s.id === id)) return { ok: false, error: 'Step not found.' };

  const booted = await ensureSidecar();
  if (!booted.ok) return booted;

  // The engine needs the session directory and image settings even when we are
  // only replacing one step, since it writes the screenshot itself.
  sidecar.startSession(session.dir, [process.pid], {
    imageFormat: settings.values.imageFormat,
    imageQuality: settings.values.imageQuality,
    imageScale: settings.values.imageScale,
    recordKeyboard: settings.values.recordKeyboard,
  });
  sidecar.pause();
  sidecar.armOnce(id);

  // Get out of the user's way: they are about to click the real application.
  win.minimize();

  const captured = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      sidecar.pause();
      resolve(null);
    }, 120000);

    const onStep = (step) => {
      if (step.replaces !== id) return;
      clearTimeout(timer);
      sidecar.off('step', onStep);
      resolve(step);
    };
    sidecar.on('step', onStep);
  });

  win.restore();
  win.focus();

  return captured
    ? { ok: true, step: session.steps.find((s) => s.id === id) }
    : { ok: false, error: 'Timed out waiting for a click.' };
});

ipcMain.handle('windows:list', async () => {
  const booted = await ensureSidecar();
  if (!booted.ok) return { ok: false, error: booted.error };
  return { ok: true, windows: await sidecar.listWindows([process.pid]) };
});

ipcMain.handle('scope:set', (_e, { pids, label }) => {
  scopePids = Array.isArray(pids) ? pids : [];
  scopeLabel = label || 'Everything';
  log.info(`capture scope: ${scopeLabel} (${scopePids.join(',') || 'all'})`);
  return { ok: true, label: scopeLabel };
});

ipcMain.handle('scope:get', () => ({ pids: scopePids, label: scopeLabel }));

ipcMain.handle('settings:get', () => settings.values);

ipcMain.handle('settings:set', (_e, patch) => settings.update(patch));

ipcMain.handle('settings:chooseFolder', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Where should recordings be saved?',
    defaultPath: settings.values.saveRoot,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, values: settings.update({ saveRoot: r.filePaths[0] }) };
});

ipcMain.handle('session:reveal', () => {
  if (!session) return { ok: false };
  shell.openPath(session.dir);
  return { ok: true };
});

ipcMain.handle('shot:url', (_e, { screenshot }) => {
  if (!session || !screenshot) return null;
  const abs = path.join(session.dir, screenshot);
  return fs.existsSync(abs) ? 'bsr://step/' + encodeURIComponent(abs) : null;
});
