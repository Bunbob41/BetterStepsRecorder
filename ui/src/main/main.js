const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Sidecar } = require('./sidecar');
const { Session } = require('./session');
const { Settings } = require('./settings');
const log = require('./log');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let win = null;
let sidecar = null;
let session = null;
let settings = null;

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
  settings = new Settings(app.getPath('userData'));
  log.info(`settings: ${JSON.stringify(settings.values)}`);
  wireSidecar();
  createWindow();
});

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
  });
  send('session:saved', { dir, count: 0 });
  return { ok: true, dir };
});

ipcMain.handle('recording:pause',  () => { sidecar.pause();  return { ok: true }; });
ipcMain.handle('recording:resume', () => { sidecar.resume(); return { ok: true }; });

ipcMain.handle('recording:stop', () => {
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
