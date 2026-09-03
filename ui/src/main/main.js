const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Sidecar } = require('./sidecar');
const { Session } = require('./session');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let win = null;
let sidecar = null;
let session = null;

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
    const result = session.addStep(step);
    send('session:step', result);
    send('session:saved', { dir: session.dir, count: session.steps.length });
  });

  sidecar.on('exit', (code) => send('sidecar:exit', { code }));
}

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

ipcMain.handle('recording:start', async () => {
  const exe = Sidecar.resolveExe(PROJECT_ROOT);
  if (!exe) {
    return { ok: false, error: 'Capture engine not found. Build it with: dotnet build capture' };
  }

  const dir = path.join(os.homedir(), 'Documents', 'StepRecordings',
    `session-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  session = new Session(dir);

  if (!sidecar.running) {
    sidecar.start(exe);
    await new Promise((resolve) => {
      sidecar.once('ready', resolve);
      setTimeout(resolve, 4000);   // don't hang the UI if the engine is wedged
    });
  }

  // Our own process, so clicking Stop does not become the last recorded step.
  sidecar.startSession(dir, [process.pid]);
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
