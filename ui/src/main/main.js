const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Sidecar } = require('./sidecar');
const { Session } = require('./session');
const { Settings } = require('./settings');
const log = require('./log');
const { buildHtml, buildMarkdown, copyImages, exportable,
        markerPosition } = require('./export');
const composite = require('./composite');
const screenshots = require('./screenshots');
const { toJpeg } = require('./transcode');
const annotate = require('../renderer/annotate');
const sections = require('../renderer/sections');
const find = require('../renderer/find');
const crop = require('../renderer/crop');
const buildInfo = require('./build-info');
const templating = require('./template');
const docx = require('./docx');
const templatesLib = require('./templates-lib');
const shortcuts = require('./shortcuts');
const bounds = require('./bounds');
const paths = require('./paths');
const { History } = require('./history');
const library = require('./library');
const archive = require('./archive');
// Shared with the window, so a scope label reads the same in the strip as
// it does in the library: "Google Chrome", not chrome.exe.
const appName = require('../renderer/appname');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let win = null;
let sidecar = null;
let session = null;
let settings = null;

// Scope chosen for the next recording: [] means everything.
let scopePids = [];
let scopeLabel = 'Everything';
let recordingPaused = false;

// Undo and redo. Session-scoped: it exists to cover a slip during editing, not
// to be a document revision system. The shape of it lives in history.js -
// applying an entry returns the entry that puts it back, which is what makes
// redo the same code as undo pointed the other way.
const history = new History({
  // Once an entry can no longer be reached, its stashed original is just a
  // copy of redacted pixels sitting on disk.
  discard: (token) => { if (session) session.discard(token); },
});

function sendDepth() { send('undo:depth', history.depth); }

function pushUndo(entry) {
  history.push(entry);
  sendDepth();
}

/** Closes the current session: history goes, and so do the stashed originals. */
function closeSession() {
  history.clear();
  if (session) session.purgeTrash();
  sendDepth();
}

// The bound accelerators, kept so they can be released before rebinding.
let boundHotkeys = { pause: null, stop: null };

// Screenshots live outside the app directory, so a custom protocol serves them
// instead of loosening webSecurity for the whole renderer.
protocol.registerSchemesAsPrivileged([
  { scheme: 'bsr', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/**
 * A sensible size for THIS display. The previous hardcoded 1280x860 is in
 * logical pixels, so at 125% scaling it asked for 1600x1075 physical against a
 * 1920x1020 work area - taller than the screen allows, which Windows clamps,
 * and the app appeared to start maximised.
 */
function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  const width = Math.min(1280, Math.round(workArea.width * 0.82));
  const height = Math.min(860, Math.round(workArea.height * 0.86));
  return {
    width,
    height,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
  };
}

/** The smallest the editor is usable at - relaxed on displays too small for it. */
const MIN_SIZE = { width: 940, height: 600 };

/**
 * Keeps a window inside the work area of the display it is actually on.
 *
 * defaultBounds() sizes from the primary display, but Windows may open the
 * window on another one - and a second monitor can be shorter, or have its
 * taskbar somewhere else. The window then runs past the work area and the
 * bottom of the interface, the status bar, sits behind the taskbar where it
 * cannot be read or clicked.
 */
function fitToDisplay(target) {
  if (!target || target.isDestroyed()) return;

  const current = target.getBounds();
  const { workArea } = screen.getDisplayMatching(current);
  const fitted = bounds.fit(current, workArea, MIN_SIZE);

  // Relax the minimum first: setBounds cannot go below it, so a window on a
  // display shorter than MIN_SIZE would be clamped straight back to too tall.
  target.setMinimumSize(fitted.minWidth, fitted.minHeight);
  if (bounds.differs(current, fitted)) {
    target.setBounds({ x: fitted.x, y: fitted.y,
                       width: fitted.width, height: fitted.height });
  }
}

function createWindow() {
  win = new BrowserWindow({
    ...defaultBounds(),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: '#16171b',
    title: 'Steps Recorder',
    icon: path.join(__dirname, '..', '..', 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.removeMenu();
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // The display it opens on is not necessarily the one it was sized for.
  win.once('ready-to-show', () => fitToDisplay(win));

  // The compositor keeps a hidden window alive between exports. Electron counts
  // it, so leaving it open would stop 'window-all-closed' ever firing and the
  // application would keep running with nothing on screen. It goes when this
  // window does.
  win.once('closed', () => composite.dispose());

  // A monitor unplugged mid-session can leave the window off-screen entirely.
  screen.on('display-removed', () => fitToDisplay(win));
  screen.on('display-metrics-changed', () => fitToDisplay(win));
}

function wireSidecar() {
  sidecar = new Sidecar();

  sidecar.on('ready', (m) => {
    // Kept so Settings can show what the engine actually is, not what the
    // interface assumes it is.
    engineBuild = m && m.built ? m.built : null;
    send('sidecar:ready', m);
  });
  sidecar.on('log', (m) => send('sidecar:log', m));
  sidecar.on('error', (m) => { leaveCompact(); send('sidecar:error', m); });

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

  sidecar.on('exit', (code) => {
    // Without this, an engine killed by antivirus or a crash leaves the window
    // as a floating strip with every other control hidden and no way back.
    leaveCompact();
    send('sidecar:exit', { code });
  });
}

process.on('uncaughtException', (err) => log.error(err));
process.on('unhandledRejection', (err) => log.error(err));

app.whenReady().then(() => {
  // bsr://step/<encoded absolute path> -> that file, and nothing outside the
  // active session directory.
  protocol.handle('bsr', (request) => {
    const url = new URL(request.url);
    const target = path.normalize(decodeURIComponent(url.pathname.replace(/^\//, '')));

    // Not startsWith: `C:\Recordings\session-10` starts with
    // `C:\Recordings\session-1`, so every sibling recording passed the check
    // this was written to make.
    if (!session || !paths.insideDir(session.dir, target)) {
      return new Response('forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(target).href);
  });

  log.init(app.getPath('userData'));
  settings = new Settings(app.getPath('userData'),
                          { documentsDir: app.getPath('documents') });
  log.info(`settings: ${JSON.stringify(settings.values)}`);
  // After settings: the chords come from them.
  registerHotkeys();
  wireSidecar();
  log.info(buildInfo.summarise(currentBuild()));
  createWindow();
});

/**
 * Pause and stop have to work while another application is in front, because
 * that is where the user is during a recording. Making them hunt for this
 * window mid-flow puts the hunt into the guide they are recording.
 */
function registerHotkeys() {
  // Release whatever is currently held, or a rebind leaves the old chord live.
  globalShortcut.unregisterAll();
  const wanted = shortcuts.resolve(settings ? settings.values : {});

  // One key for all three states of a recording. It used to do nothing at all
  // when none was running, which is indistinguishable from a hotkey that is
  // not working - and starting is what somebody reaches for it to do.
  const paused = globalShortcut.register(wanted.pause, () => {
    if (!sidecar || !sidecar.running) { startFromHotkey(); return; }
    recordingPaused = !recordingPaused;
    if (recordingPaused) sidecar.pause(); else sidecar.resume();
    log.info(`hotkey: ${recordingPaused ? 'paused' : 'resumed'}`);
    send('hotkey', { action: recordingPaused ? 'paused' : 'resumed' });
  });

  const stopped = globalShortcut.register(wanted.stop, () => {
    // Restore first and unconditionally. Gating this on the engine still
    // running is how the window got stranded as a strip with no way back.
    leaveCompact();
    if (!sidecar || !sidecar.running) {
      // Silence is what makes a working hotkey look broken.
      send('hotkey', { action: 'idle' });
      return;
    }
    finishRecording();
    log.info('hotkey: stopped');
    send('hotkey', { action: 'stopped' });
  });

  boundHotkeys = { pause: paused ? wanted.pause : null,
                   stop: stopped ? wanted.stop : null };

  if (!paused || !stopped) {
    // Another application already owns the combination; the buttons still work.
    log.warn(`hotkey registration failed (pause=${paused}, stop=${stopped})`);
  }
  send('hotkeys', hotkeyState());
  return { paused, stopped, wanted };
}

/** What the interface should show: what was asked for, and what actually took. */
function hotkeyState() {
  const wanted = shortcuts.resolve(settings ? settings.values : {});
  return {
    pause: wanted.pause,
    stop: wanted.stop,
    pauseActive: boundHotkeys.pause === wanted.pause,
    stopActive: boundHotkeys.stop === wanted.stop,
  };
}

app.on('will-quit', () => globalShortcut.unregisterAll());

app.on('window-all-closed', () => {
  if (sidecar) sidecar.stop();
  app.quit();
});

// A global mouse hook must never outlive the UI.
app.on('before-quit', () => {
  if (sidecar) sidecar.stop();
  closeSession();
});
process.on('exit', () => { if (sidecar) sidecar.kill(); });

// ---- recording mode ---------------------------------------------------------
// While recording, the user is inside the application they are documenting.
// A full editor window is the one thing that should not be on screen, so the
// window shrinks to a floating strip and returns afterwards. PSR did this and
// it is the reason it felt usable despite everything else about it.

const COMPACT = { width: 360, height: 132 };
let fullBounds = null;
let engineBuild = null;

function enterCompact() {
  if (!win || fullBounds) return;
  fullBounds = win.getBounds();

  // The display the window is on, not the primary one: otherwise the strip
  // teleports across and lands on top of the application being recorded.
  const { workArea } = screen.getDisplayMatching(fullBounds);
  win.setMinimumSize(280, 110);
  win.setBounds({
    ...COMPACT,
    x: workArea.x + workArea.width - COMPACT.width - 24,
    y: workArea.y + 24,
  });
  win.setAlwaysOnTop(true, 'floating');
  send('mode', { compact: true });
  win.webContents.invalidate();
}

function leaveCompact() {
  if (!win || !fullBounds) return;
  win.setAlwaysOnTop(false);
  win.setMinimumSize(MIN_SIZE.width, MIN_SIZE.height);
  win.setBounds(fullBounds);
  fullBounds = null;
  // A recording can outlast a monitor: the bounds saved on the way in may now
  // be on a display that is no longer there.
  fitToDisplay(win);
  send('mode', { compact: false });

  // The layout is correct after this resize but the compositor is not: the
  // screenshot's layer keeps painting at its pre-resize offset, over the
  // toolbar, swallowing clicks meant for the buttons underneath. Verified by
  // reading getBoundingClientRect, which reported the right position while the
  // screen showed the wrong one. invalidate() forces a full repaint.
  win.webContents.invalidate();

}

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

ipcMain.handle('templates:effective', () => ({
  path: settings.values.templatePath
     || templatesLib.defaultFor(PROJECT_ROOT, app.getPath('userData')) || '',
  chosen: Boolean(settings.values.templatePath),
}));

ipcMain.handle('templates:list', () =>
  templatesLib.list(PROJECT_ROOT, app.getPath('userData')));

ipcMain.handle('templates:duplicate', async (_e, { path: source } = {}) => {
  const from = source || settings.values.templatePath
            || templatesLib.defaultFor(PROJECT_ROOT, app.getPath('userData'));
  const r = templatesLib.duplicate(from, app.getPath('userData'));
  if (!r.ok) return r;

  // Select the copy immediately: the point of making it is to use it.
  settings.set({ templatePath: r.path });
  log.info(`template copied to ${r.path}`);

  // And open it, because the next thing anyone wants to do is edit it.
  const problem = await shell.openPath(r.path);
  return { ok: true, path: r.path, values: settings.values,
           opened: !problem, openError: problem || null };
});

ipcMain.handle('templates:reveal', () => {
  shell.openPath(templatesLib.userDir(app.getPath('userData')));
  return { ok: true };
});

/**
 * Begins a recording.
 *
 * A function rather than only an IPC handler, because the start hotkey has to
 * do exactly this without a window involved - and a second implementation of
 * "start a recording" is how the two come to disagree about scope, intent or
 * which pids are excluded.
 */
async function beginRecording(intent = {}) {
  log.info('recording:start invoked');
  const exe = Sidecar.resolveExe(PROJECT_ROOT);
  log.info(`capture engine: ${exe}`);
  if (!exe) {
    return { ok: false, error: 'Capture engine not found. Build it with: dotnet build capture' };
  }

  const writable = settings.probe();
  if (!writable.ok) {
    leaveCompact();
    return { ok: false, error: `Cannot write to ${settings.values.saveRoot}: ${writable.error}` };
  }

  const dir = path.join(settings.values.saveRoot,
    `session-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  log.info(`creating session at ${dir}`);
  closeSession();
  session = new Session(dir);
  session.rename(intent.name || new Date().toLocaleString());

  // Decided before recording, not at export: it changes how the steps are
  // worded on the way out, and the person starting knows what they are making.
  session.setIntent({
    purpose: intent.purpose || 'sop',
    templatePath: intent.purpose === 'sop'
      ? templatesLib.defaultFor(PROJECT_ROOT, app.getPath('userData'),
                                intent.templatePath || settings.values.templatePath)
      : '',
  });

  if (Array.isArray(intent.scopePids)) {
    scopePids = intent.scopePids;
    scopeLabel = intent.scopeLabel || (intent.scopePids.length ? 'One application' : 'Everything');
  }

  const booted = await ensureSidecar();
  if (!booted.ok) return booted;

  // Our own process, so clicking Stop does not become the last recorded step.
  const started = sidecar.startSession(dir, [process.pid], {
    imageFormat: settings.values.imageFormat,
    imageQuality: settings.values.imageQuality,
    imageScale: settings.values.imageScale,
    imageFrame: settings.values.imageFrame,
    recordKeyboard: settings.values.recordKeyboard,
    allowPids: scopePids,
    // So pressing the stop hotkey is not itself the final recorded step.
    hotkeys: shortcuts.engineChords(settings.values),
  });

  if (!started) {
    return { ok: false, error: 'The capture engine did not accept the recording.' };
  }

  // Only once recording is genuinely under way: shrinking for a start that
  // failed leaves the user in a strip with nothing recording.
  enterCompact();
  send('session:saved', { dir, count: 0 });
  return {
    ok: true, dir, scope: scopeLabel, name: session.name,
    purpose: session.purpose, templatePath: session.templatePath,
  };
}

ipcMain.handle('recording:start', (_e, intent = {}) => beginRecording(intent));

/**
 * Starts a recording of whatever application is in front, from the hotkey.
 *
 * The moment a global hotkey is most useful is the moment you are already in
 * the application you want to document - which is exactly the moment the
 * window is not in front of you and a setup dialog would drag you out of it.
 *
 * So nothing is asked. Scope comes from the window that had focus when the key
 * was pressed, which is both the likeliest answer and a narrower one than the
 * dialog's default of everything on screen: pressing a key by accident cannot
 * quietly start recording your mail.
 */
async function startFromHotkey() {
  const booted = await ensureSidecar();
  if (!booted.ok) {
    send('hotkey', { action: 'failed', error: booted.error });
    return;
  }

  let front = null;
  try {
    const windows = await sidecar.listWindows([process.pid]);
    front = windows.find((w) => w.foreground) || null;
  } catch (err) {
    log.warn(`hotkey start: could not read the foreground window: ${err.message}`);
  }

  // No foreground window means the desktop, or a window we are not allowed to
  // see. Recording everything is the honest fallback - and it is said out loud
  // in the strip, rather than assumed.
  const label = front ? appName.friendly(front.process) : 'Everything';
  const r = await beginRecording({
    name: '',
    purpose: 'sop',
    scopePids: front ? [front.pid] : [],
    scopeLabel: label,
  });

  if (!r.ok) {
    send('hotkey', { action: 'failed', error: r.error });
    return;
  }
  log.info(`hotkey: started, scoped to ${label}`);
  send('hotkey', { action: 'started', session: r });
}

// The renderer calls this whenever it believes recording has ended. Compact
// mode is a property of the UI, so it must not be exitable only through paths
// that happen to know about the capture engine.
ipcMain.handle('ui:restore', () => { leaveCompact(); return { ok: true }; });

ipcMain.handle('recording:pause',  () => { recordingPaused = true;  sidecar.pause();  return { ok: true }; });
ipcMain.handle('recording:resume', () => { recordingPaused = false; sidecar.resume(); return { ok: true }; });

/**
 * Ends a recording. Both the Stop button and the global hotkey come here, so
 * that anything which should happen at the end of a recording happens once and
 * in one place rather than twice, slightly differently.
 */
function finishRecording() {
  recordingPaused = false;
  leaveCompact();
  sidecar.stop();

  // Said after the recording rather than during it: mid-recording the user is
  // inside the application they are documenting, and the window is a strip.
  if (session) {
    const advice = screenshots.advise({
      files: shotFiles(session),
      format: settings.values.imageFormat,
    });
    if (advice) {
      log.info(`size notice: ${(advice.total / 1048576).toFixed(0)}MB, `
               + `${(advice.average / 1048576).toFixed(1)}MB per shot`);
      send('notice', { kind: 'size', message: advice.message });
    }
  }
}

ipcMain.handle('recording:stop', () => {
  finishRecording();
  return { ok: true, steps: session ? session.steps.length : 0 };
});

/**
 * Which build is running. Reported in Settings and in the log, because the
 * version number alone does not distinguish two builds of the same version -
 * and that is the usual question when something is or is not fixed.
 */
function currentBuild() {
  return buildInfo.describe({
    version: app.getVersion(),
    projectRoot: PROJECT_ROOT,
    engineExe: Sidecar.resolveExe(PROJECT_ROOT),
  });
}

ipcMain.handle('app:build', () => {
  const info = currentBuild();
  return { ...info, engineReported: engineBuild };
});

ipcMain.handle('session:get', () => ({
  dir: session ? session.dir : null,
  steps: session ? session.steps : [],
  purpose: session ? session.purpose : 'sop',
  templatePath: session ? session.templatePath : '',
}));

ipcMain.handle('step:addNote', (_e, { text, afterId }) =>
  session ? session.addNote(text, afterId) : null);

ipcMain.handle('step:addSection', (_e, { text, afterId }) =>
  session ? session.addSection(text, afterId) : null);

ipcMain.handle('step:update', (_e, { id, patch }) =>
  session ? session.updateStep(id, patch) : null);

ipcMain.handle('step:remove', (_e, { id }) => {
  if (!session) return false;
  const removed = session.removeStep(id);
  if (!removed) return false;
  pushUndo({ type: 'restoreSteps', removals: [removed] });
  return true;
});

/**
 * Removes several steps as a single undoable action. Deleting twenty steps and
 * pressing Ctrl+Z twenty times to get them back is not undo, and a selection
 * larger than UNDO_LIMIT would have been partly unrecoverable.
 */
ipcMain.handle('step:removeMany', (_e, { ids }) => {
  if (!session || !Array.isArray(ids) || !ids.length) return { ok: false };

  const removals = [];
  for (const id of ids) {
    const removed = session.removeStep(id);
    if (removed) removals.push(removed);
  }
  if (!removals.length) return { ok: false };

  pushUndo({ type: 'restoreSteps', removals });
  return { ok: true, removed: removals.length, steps: session.steps };
});

/**
 * One implementation, pointed either way.
 *
 * There is no separate redo path to drift out of step with the undo path: both
 * pop from one stack, apply, and push what comes back onto the other.
 */
function step_back(direction) {
  if (!session) return { ok: false, empty: true };
  const r = direction === 'redo' ? history.redo(session) : history.undo(session);
  sendDepth();
  if (!r.ok) return r;
  return { ok: true, action: r.type, steps: session.steps };
}

ipcMain.handle('edit:undo', () => step_back('undo'));
ipcMain.handle('edit:redo', () => step_back('redo'));

ipcMain.handle('edit:undoDepth', () => history.depth);

/**
 * Replaces a word everywhere it appears, as ONE undoable action.
 *
 * One entry, not one per step: replacing a term across forty steps and
 * pressing Ctrl+Z forty times is not undo. This is the same bargain
 * `step:removeMany` makes.
 *
 * Until this existed nothing in the undo history covered text at all - only
 * deletions and redactions - so a bulk edit was the one irreversible thing in
 * the application.
 */
ipcMain.handle('steps:replaceAll', (_e, { query, replacement, options }) => {
  if (!session) return { ok: false, error: 'No recording is open.' };

  const changes = find.plan(session.steps, query, replacement, options || {});
  if (!changes.length) return { ok: true, changes: 0, message: find.describe([]) };

  // Read the prior state before writing any of it. Gathering it afterwards
  // would report whatever the write left behind, which is only the right
  // answer while the write happens to preserve it.
  const before = changes.map((c) => {
    const step = session.steps.find((s) => s.id === c.id);
    return { id: c.id, was: c.was, wasEdited: Boolean(step && step.textEdited) };
  });

  for (const b of before) {
    const c = changes.find((x) => x.id === b.id);
    // Whether this row's wording was already the author's own is preserved
    // rather than set: see the note in Session.updateStep.
    session.updateStep(c.id, { text: c.text, textEdited: b.wasEdited });
  }

  pushUndo({ type: 'retext', changes: before });

  return { ok: true, changes: changes.length, message: find.describe(changes),
           steps: session.steps };
});

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
  if (!session) return null;
  // Inside the recording or nowhere: this reads a file and hands its bytes to
  // the window, and the name comes from a session.json that may not be ours.
  const abs = paths.safeJoin(session.dir, screenshot);
  if (!abs || !fs.existsSync(abs)) return null;
  const mime = /\.jpe?g$/i.test(abs) ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
});

/**
 * Writes new pixels over a step's screenshot, keeping the old ones for undo.
 *
 * Beside the original and renamed over it, so an interrupted write cannot leave
 * a truncated screenshot where a real one used to be. A locked or read-only
 * file must come back as an error, not as a rejected promise the renderer
 * swallows in a mouse handler.
 */
function rewriteScreenshot(step, dataUrl) {
  const match = /^data:image\/png;base64,(.+)$/.exec(dataUrl || '');
  if (!match) return { ok: false, error: 'Expected a PNG data URL.' };

  // A screenshot can be shared: the engine writes one file when two
  // consecutive captures are identical. Editing in place would edit the other
  // step's picture too, so the step gets a copy of its own first - and every
  // destructive pixel write in the application comes through here, which is
  // why this is the only place that has to remember.
  if (!session.forkScreenshot(step)) {
    return { ok: false, error: 'Could not give that step a screenshot of its own.' };
  }

  // The write. A crafted recording naming a path outside itself would have
  // this replace that file with a blurred screenshot, and stash() would move
  // the original into the recording's trash on the way - so the check belongs
  // here most of all.
  const file = paths.safeJoin(session.dir, step.screenshot);
  if (!file) {
    return { ok: false, error: 'That step points outside the recording.' };
  }

  const bytes = Buffer.from(match[1], 'base64');
  const token = session.stash(step.screenshot);
  const temp = file + '.tmp';

  try {
    fs.writeFileSync(temp, bytes);
    fs.renameSync(temp, file);
  } catch (err) {
    session.discard(token);
    try { fs.unlinkSync(temp); } catch { /* may not exist */ }
    log.error(err);
    return { ok: false, error: `Could not update the screenshot: ${err.message}` };
  }

  return { ok: true, token };
}

/**
 * Trims a screenshot, and trims the step's frame by the same proportion.
 *
 * Both, always. The click marker is stored as a percentage of `frame`, so an
 * image cut without its frame puts the marker somewhere else on every export
 * with nothing on screen to show it happened - and a screenshot that is no
 * longer the size of its frame breaks the one thing every exporter assumes.
 */
ipcMain.handle('step:crop', (_e, { id, dataUrl, rect, image }) => {
  if (!session) return { ok: false, error: 'No recording is open.' };

  const step = session.steps.find((s) => s.id === id);
  if (!step || !step.screenshot) return { ok: false, error: 'Step not found.' };
  if (!rect || !image) return { ok: false, error: 'No region to crop to.' };
  if (!crop.isDeliberate(rect, image)) {
    return { ok: false, error: 'That region is too small to crop to.' };
  }

  const written = rewriteScreenshot(step, dataUrl);
  if (!written.ok) return written;

  const nextFrame = crop.frameAfter(step.frame, rect, image);

  pushUndo({
    type: 'pixels', id: step.id, screenshot: step.screenshot,
    token: written.token,
    state: {
      redacted: step.redacted === true,
      annotated: step.annotated === true,
      highlights: [...(step.highlights || [])],
      cropped: step.cropped === true,
      // The frame goes back with the pixels. One without the other is what a
      // crop must never leave behind.
      frame: step.frame ? { ...step.frame } : null,
    },
  });

  const updated = session.updateStep(id, {
    ...(nextFrame ? { frame: nextFrame } : {}),
    cropped: true,
    editedAt: new Date().toISOString(),
  });

  log.info(`cropped step ${id} to ${Math.round(rect.w)}x${Math.round(rect.h)}`);
  return { ok: true, step: updated };
});

/**
 * Moves the click indicator, or puts it back where it was recorded.
 *
 * A typed step is anchored at the CENTRE of the focused control, because the
 * engine has no way to know where the caret is - so on a large text area or a
 * wide search box the marker lands in the middle of the box rather than where
 * the words went. That is not a defect to be fixed in the engine; it is a
 * limitation an author needs to be able to correct.
 *
 * Stored as a percentage of the frame, exactly like the computed position, so
 * every export and the crop arithmetic follow without knowing this exists.
 */
ipcMain.handle('step:marker', (_e, { id, at }) => {
  if (!session) return { ok: false, error: 'No recording is open.' };

  const step = session.steps.find((s) => s.id === id);
  if (!step) return { ok: false, error: 'Step not found.' };

  const wanted = at && Number.isFinite(at.x) && Number.isFinite(at.y)
    ? { x: Math.max(0, Math.min(100, at.x)), y: Math.max(0, Math.min(100, at.y)) }
    : null;

  pushUndo({ type: 'marker', id,
             at: step.markerAt ? { ...step.markerAt } : null });

  // `undefined` rather than null, so putting it back removes the field
  // entirely and the step reads as one that was never moved.
  const updated = session.updateStep(id, { markerAt: wanted || undefined });
  return { ok: true, step: updated };
});

ipcMain.handle('step:redact', (_e, { id, dataUrl, kind = 'blur', colour = '' }) => {
  if (!session) return { ok: false, error: 'No recording is open.' };

  const step = session.steps.find((s) => s.id === id);
  if (!step || !step.screenshot) return { ok: false, error: 'Step not found.' };

  // The pre-blur image is kept so the edit can be undone. Blur destroys pixels
  // by design; that is only defensible if a slip is recoverable while the
  // session is open.
  const written = rewriteScreenshot(step, dataUrl);
  if (!written.ok) return written;

  // Recorded only now: a redaction that failed must not occupy an undo slot.
  pushUndo({
    type: 'pixels', id: step.id, screenshot: step.screenshot,
    token: written.token,
    state: {
      redacted: step.redacted === true,
      annotated: step.annotated === true,
      highlights: [...(step.highlights || [])],
      cropped: step.cropped === true,
      frame: step.frame ? { ...step.frame } : null,
    },
  });

  // An arrow is not a redaction. `redacted` feeds the compliance summary -
  // "N screenshot(s) had regions blurred by the author" - and marking an
  // annotation as one would claim a redaction that never happened, which is
  // the overclaiming 79f85b5 exists to prevent. Both destroy pixels and both
  // are undoable; only one is a privacy act.
  const isRedaction = kind === 'blur';

  // Which highlighter colours this step carries, so the legend can list the
  // ones a guide actually uses rather than all of them.
  const highlights = kind === 'highlight' && colour
    ? [...new Set([...(step.highlights || []), colour])]
    : step.highlights;

  const updated = session.updateStep(id, {
    ...(isRedaction ? { redacted: true } : { annotated: true }),
    ...(highlights ? { highlights } : {}),
    editedAt: new Date().toISOString(),
  });

  log.info(`${isRedaction ? 'redacted' : `annotated (${kind})`} step ${id}`);

  return { ok: true, step: updated };
});

ipcMain.handle('export:run', async (_e, args) => {
  try {
    return await runExport(args);
  } catch (err) {
    // A handler that throws rejects the invoke, and the renderer awaits it in a
    // click handler where nothing catches: the dialog closes and the export
    // silently does not happen.
    log.error(err);
    return { ok: false, error: `Export failed: ${err.message}` };
  }
});

/** The screenshot files a document for this session would carry. */
function shotFiles(s) {
  return exportable(s)
    .filter((step) => step.screenshot)
    .map((step) => path.join(s.dir, step.screenshot))
    .filter((f) => fs.existsSync(f));
}

/**
 * Every screenshot that has a click to mark, with where the click fell.
 *
 * The same `markerPosition` the HTML export uses, so Word puts the marker in
 * the place the guide beside it does. A step whose click landed outside the
 * captured frame has no position and is skipped, exactly as it is in HTML.
 */
function markableShots(s) {
  const out = [];
  for (const step of exportable(s)) {
    if (!step.screenshot || !step.point) continue;
    const file = path.join(s.dir, step.screenshot);
    if (!fs.existsSync(file)) continue;
    const pos = markerPosition(step);
    if (pos) out.push({ file, pos });
  }
  return out;
}

function dataUriFor(file, encoded) {
  if (encoded) {
    return `data:${encoded.mime};base64,${encoded.data.toString('base64')}`;
  }
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/**
 * Prepares this session's screenshots and returns the `imageSrc` hook that
 * buildHtml needs, embedding them when they fit and writing them beside the
 * document when even re-encoded they do not.
 */
function htmlImages(s, { assetDir, assetHref }) {
  const files = shotFiles(s);
  const prep = screenshots.prepare(files, { transcode: toJpeg });

  if (screenshots.canEmbed(prep.after)) {
    return {
      imageSrc: (abs) => dataUriFor(abs, prep.images && prep.images.get(abs)),
      warning: screenshots.describe(prep),
    };
  }

  // Past this point a single file is not physically possible: the base64 would
  // exceed the longest string JavaScript can hold. Say so plainly rather than
  // producing nothing, which is what used to happen.
  fs.mkdirSync(assetDir, { recursive: true });
  const names = new Map();
  for (const file of files) {
    const encoded = prep.images && prep.images.get(file);
    const name = path.basename(file, path.extname(file))
               + (encoded ? encoded.ext : path.extname(file));
    fs.writeFileSync(path.join(assetDir, name),
                     encoded ? encoded.data : fs.readFileSync(file));
    names.set(file, name);
  }

  return {
    imageSrc: (abs) => (names.has(abs) ? `${assetHref}/${names.get(abs)}` : null),
    warning: `Too large to embed even re-encoded, so the screenshots were `
           + `written to ${path.basename(assetDir)} beside the document. `
           + `That folder has to travel with it.`,
  };
}

/**
 * The highlighter key for this recording, if one was asked for.
 *
 * Off unless enabled: most guides use one colour and need no key, and a
 * one-entry legend is clutter.
 */
function legendFor(s) {
  if (!settings.values.showHighlightLegend) return [];
  return annotate.legendFor(exportable(s), settings.values.highlightMeanings || {});
}

/** How the click should be marked, as chosen in Settings. */
function markerOptions() {
  return {
    style: settings.values.markerStyle || 'circle',
    bold: Boolean(settings.values.markerBold),
  };
}

async function runExport({ format, title }) {
  if (!session || !session.steps.length) {
    return { ok: false, error: 'Nothing to export yet.' };
  }

  const safeTitle = (title || session.name || 'Recorded steps').trim() || 'Recorded steps';
  const brand = {
    name: settings.values.brandName,
    logo: settings.values.brandLogo,
    footer: settings.values.brandFooter,
  };
  const slug = safeTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();

  // The recording's own template wins: it was chosen for this recording, before
  // it was made. Declared before `filters`, which reads it.
  // Fall back to the SOP template that ships with the app. Refusing here was a
  // dead end for anyone who had never set one up - which is everybody on their
  // first run - even though a perfectly good Word template was sitting in the
  // installation the whole time. defaultFor() was already doing this when a
  // recording starts; export simply never asked.
  const templateForSession = session.templatePath
    || settings.values.templatePath
    || templatesLib.defaultFor(PROJECT_ROOT, app.getPath('userData'))
    || '';
  if (format === 'template' && !templateForSession) {
    return { ok: false, error: 'No template is available to render into.' };
  }

  const filters = {
    html: [{ name: 'Web page', extensions: ['html'] }],
    md: [{ name: 'Markdown', extensions: ['md'] }],
    pdf: [{ name: 'PDF', extensions: ['pdf'] }],
    template: templateForSession.toLowerCase().endsWith('.docx')
      ? [{ name: 'Word document', extensions: ['docx'] }]
      : [{ name: 'Document', extensions: ['md', 'html', 'txt'] }],
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
      // than a document that breaks the moment it is emailed on its own -
      // unless they are too large to embed at all, which htmlImages handles.
      const base = path.basename(out, '.html');
      const { imageSrc, warning } = htmlImages(session, {
        assetDir: path.join(path.dirname(out), `${base}-images`),
        assetHref: `${base}-images`,
      });
      fs.writeFileSync(out, buildHtml(session, {
        title: safeTitle, brand, voice: voiceFor(session), imageSrc,
        markerOpts: markerOptions(), legend: legendFor(session),
      }), 'utf8');
      log.info(`exported html to ${out}`);
      return { ok: true, file: out, warning };

    } else if (format === 'md') {
      const imageDir = `${path.basename(out, '.md')}-images`;
      const copied = copyImages(session, path.join(path.dirname(out), imageDir));
      fs.writeFileSync(out, buildMarkdown(session, {
        title: safeTitle, imageDir, brand, voice: voiceFor(session),
      }), 'utf8');
      log.info(`markdown export copied ${copied} images`);

    } else if (format === 'pdf') {
      const warning = await exportPdf(safeTitle, out, brand);
      log.info(`exported pdf to ${out}`);
      return { ok: true, file: out, warning };

    } else if (format === 'template') {
      const tpl = templateForSession;
      if (!fs.existsSync(tpl)) {
        return { ok: false, error: `The template is no longer at ${tpl}` };
      }

      // Word templates go through their own renderer: a .docx is a zip of XML
      // parts, and Word splits a typed placeholder across runs, so it cannot be
      // filled by string replacement the way a Markdown file can.
      if (tpl.toLowerCase().endsWith('.docx')) {
        // The same screenshots, prepared the same way: every byte of them
        // would otherwise go into the zip.
        const prep = screenshots.prepare(shotFiles(session), { transcode: toJpeg });

        // Then the click marker, drawn INTO the pixels. Word embeds a picture
        // and cannot lay anything over it, so a marker that HTML and PDF add in
        // CSS has to be part of the image here or it is not in the document at
        // all. Shrinking first and marking second, so the marker is drawn at
        // the size the reader will see rather than being resampled away.
        const marks = await composite.markAll(markableShots(session), {
          images: prep.images,
          markerOpts: markerOptions(),
          onError: (file, err) =>
            log.warn(`could not mark ${path.basename(file)}: ${err.message}`),
        });
        if (marks.failed) {
          log.warn(`${marks.failed} screenshot(s) went into the document unmarked`);
        }
        if (marks.shared) {
          log.warn(`${marks.shared} step(s) share a screenshot with an earlier one; `
                   + `it carries the first step's marker`);
        }

        const { buffer, missing } = await docx.render(tpl, session, {
          title: safeTitle,
          brand,
          voice: voiceFor(session),
          legend: legendFor(session),
          images: marks.images,
          redactionSummary: templating.redactionSummary(session.steps),
        });
        fs.writeFileSync(out, buffer);
        log.info(`docx export: ${(buffer.length / 1024).toFixed(0)}KB, `
                 + `${missing.length} missing images`);
        return {
          ok: true,
          file: out,
          warning: [
            missing.length
              ? `${missing.length} screenshot(s) were missing and left out`
              : null,
            screenshots.describe(prep),
          ].filter(Boolean).join(' ') || null,
        };
      }

      // Read, never written: the organisation's format is the one thing this
      // feature must not alter.
      const source = fs.readFileSync(tpl, 'utf8');
      const imageDir = `${path.basename(out, path.extname(out))}-images`;
      const { text, report } = templating.render(source, session, {
        title: safeTitle, imageDir, brand, voice: voiceFor(session),
        legend: legendFor(session),
      });

      const copied = templating.copyImages(session, path.join(path.dirname(out), imageDir));
      fs.writeFileSync(out, text, 'utf8');
      log.info(`template export: ${report.filled.length} hooks filled, `
               + `${report.unknown.length} unrecognised, ${copied} images`);

      return {
        ok: true,
        file: out,
        // Surfaced rather than swallowed: a mistyped hook silently produces a
        // document with a gap in it, which nobody notices until an auditor does.
        warning: report.unknown.length
          ? `Unrecognised hooks left untouched: ${report.unknown.join(', ')}`
          : null,
      };

    } else {
      // Without this, an unrecognised format wrote nothing and still reported
      // success, pointing the user at a file that was never created.
      throw new Error(`Unsupported export format: ${format}`);
    }

    log.info(`exported ${format} to ${out}`);
    return { ok: true, file: out };

  } catch (err) {
    log.error(err);
    return { ok: false, error: err.message };
  }
}

/**
 * Renders the same HTML in an offscreen window and prints it. Reusing the HTML
 * exporter keeps one layout to maintain rather than a separate PDF renderer.
 */
/**
 * A procedure tells the reader what to do; an evidence record states what was
 * done, and rewriting it into instructions would misrepresent it.
 */
function voiceFor(s) {
  return s && s.purpose === 'evidence' ? 'past' : 'imperative';
}

async function exportPdf(title, outFile, brand) {
  // The printer loads this from a temp directory, so images that cannot be
  // embedded go beside the temp page rather than beside the finished PDF.
  const stem = `bsr-export-${Date.now()}`;
  const tempDir = app.getPath('temp');
  const { imageSrc, warning } = htmlImages(session, {
    assetDir: path.join(tempDir, `${stem}-images`),
    assetHref: `${stem}-images`,
  });

  const html = buildHtml(session, {
    title, brand, voice: voiceFor(session), imageSrc,
    markerOpts: markerOptions(), legend: legendFor(session),
  });
  const temp = path.join(tempDir, `${stem}.html`);
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
    try {
      fs.rmSync(path.join(tempDir, `${stem}-images`), { recursive: true, force: true });
    } catch { /* likewise */ }
  }

  return warning;
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
    imageFrame: settings.values.imageFrame,
    recordKeyboard: settings.values.recordKeyboard,
    // The scope applies here too. Without it, re-recording one step of a
    // recording deliberately scoped to a single application would capture a
    // click in any application at all.
    allowPids: scopePids,
    hotkeys: shortcuts.engineChords(settings.values),
  });
  sidecar.pause();
  sidecar.armOnce(id);

  // Get out of the user's way: they are about to click the real application.
  win.minimize();

  const captured = await new Promise((resolve) => {
    // Both paths must detach the listener. Leaving it attached on timeout
    // accumulated a dead closure per abandoned re-record.
    const finish = (value) => {
      clearTimeout(timer);
      sidecar.off('step', onStep);
      resolve(value);
    };

    const timer = setTimeout(() => {
      sidecar.pause();
      finish(null);
    }, 120000);

    const onStep = (step) => {
      if (step.replaces !== id) return;
      finish(step);
    };

    sidecar.on('step', onStep);
  });

  win.restore();
  win.focus();

  return captured
    ? { ok: true, step: session.steps.find((s) => s.id === id) }
    : { ok: false, error: 'Timed out waiting for a click.' };
});

/**
 * Recent recordings, newest first. Read straight from disk so the list is
 * correct even for sessions this process never opened.
 */
ipcMain.handle('library:list', () => library.list(settings.values.saveRoot));

/**
 * Searches every recording, not the open one.
 *
 * Reads from disk on each search rather than keeping an index: a few hundred
 * small JSON files is milliseconds, and an index would be wrong the moment a
 * recording is edited outside the application.
 */
/** What the recordings folder holds, so its cost is never a surprise. */
ipcMain.handle('library:usage', () => {
  const root = settings.values.saveRoot;
  try {
    const rows = library.list(root);
    return {
      ok: true, root,
      recordings: rows.length,
      bytes: rows.reduce((n, r) => n + (r.bytes || 0), 0),
    };
  } catch (err) {
    log.error(err);
    return { ok: false, root, recordings: 0, bytes: 0 };
  }
});

ipcMain.handle('library:search', (_e, { query, options } = {}) => {
  const root = settings.values.saveRoot;
  try {
    return { ok: true, results: archive.search(root, query, options || {}) };
  } catch (err) {
    log.error(err);
    return { ok: false, error: `Could not search: ${err.message}` };
  }
});

ipcMain.handle('library:open', (_e, { dir }) => {
  if (!dir || !fs.existsSync(path.join(dir, 'session.json'))) {
    return { ok: false, error: 'That recording is no longer there.' };
  }

  const opened = Session.load(dir);
  if (opened.unreadable) {
    // Deliberately not adopted as the current session: a recording this
    // version must not write to is one it must not hold open either.
    log.warn(`refused ${dir}: ${opened.unreadable}`);
    return { ok: false, error: opened.unreadable };
  }

  closeSession();
  session = opened;
  return { ok: true, dir: session.dir, name: session.name, steps: session.steps };
});

ipcMain.handle('session:rename', (_e, { name }) =>
  session ? { ok: true, name: session.rename(name) } : { ok: false });

/**
 * Checks an open recording against the applications running right now.
 *
 * Creating a guide is a one-off; keeping it true is the work. Every step
 * already carries the automation id and name of what was clicked, so the
 * current application can be asked whether those controls are still there.
 */
ipcMain.handle('session:verify', async () => {
  if (!session || !session.steps.length) {
    return { ok: false, error: 'Open a recording first.' };
  }

  const booted = await ensureSidecar();
  if (!booted.ok) return booted;

  const checkable = session.steps.filter((s) => sections.isStep(s));
  const items = checkable.map((s) => ({
    id: s.id,
    process: (s.window && s.window.process) || '',
    windowTitle: (s.window && s.window.title) || '',
    automationId: (s.target && s.target.automationId) || '',
    name: (s.target && s.target.name) || '',
    controlType: (s.target && s.target.controlType) || '',
  }));

  const results = await sidecar.verify(items);
  if (!results) return { ok: false, error: 'The capture engine did not answer.' };

  const at = new Date().toISOString();
  const byId = new Map(results.map((r) => [r.id, r]));
  for (const step of session.steps) {
    const r = byId.get(step.id);
    if (!r) continue;
    // A point-in-time claim, so it is stamped: "checked, and at that moment
    // this control was gone" is a different statement from "this step is bad".
    step.verify = { status: r.status, matchedBy: r.matchedBy || null, at };
  }
  session.flush();

  const tally = results.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] || 0) + 1;
    return acc;
  }, {});
  log.info(`verify: ${JSON.stringify(tally)}`);

  return { ok: true, checked: results.length, tally, steps: session.steps, at };
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

ipcMain.handle('shortcuts:get', () => ({
  ...hotkeyState(),
  defaults: shortcuts.DEFAULTS,
}));

/**
 * Lets go of the global hotkeys while the user is choosing a new one.
 *
 * A registered global shortcut is taken at the operating system, ahead of every
 * window - including ours. So while this application held Ctrl+Shift+F9, a user
 * pressing Ctrl+Shift+F9 in the rebinding dialog had it swallowed by the very
 * hotkey they were trying to replace: the key press never reached the page, the
 * row sat there saying "Press keys...", and nothing changed. Trying to give
 * pause the chord that stop had was worse - it stopped the recording.
 *
 * Released for as long as the dialog is listening, and put back on every exit:
 * chosen, refused, cancelled, or the dialog simply closed.
 */
ipcMain.handle('shortcuts:capture', (_e, { on }) => {
  if (on) {
    globalShortcut.unregisterAll();
    // The interface must not go on claiming they are live while they are not.
    boundHotkeys = { pause: null, stop: null };
    send('hotkeys', hotkeyState());
    return { ok: true, listening: true };
  }
  // Idempotent on purpose: the renderer calls this on every way out of
  // listening, and some of those paths have already re-registered.
  registerHotkeys();
  return { ok: true, listening: false };
});

ipcMain.handle('shortcuts:set', (_e, { which, accelerator }) => {
  const key = which === 'stop' ? 'hotkeyStop' : 'hotkeyPause';

  // Blank restores the default rather than leaving the action unreachable.
  if (!accelerator) {
    settings.update({ [key]: '' });
    return { ok: true, ...registerHotkeys(), state: hotkeyState() };
  }

  if (!shortcuts.isValid(accelerator)) {
    // registerHotkeys, not a bare return: capture released them, and refusing
    // a chord must not be the same as turning both hotkeys off.
    registerHotkeys();
    return { ok: false, error: 'That needs a modifier — Ctrl, Alt or Shift — '
                             + 'or a function key on its own.' };
  }

  const other = which === 'stop' ? 'hotkeyPause' : 'hotkeyStop';
  const resolved = shortcuts.resolve(settings.values);
  if (accelerator === (which === 'stop' ? resolved.pause : resolved.stop)) {
    registerHotkeys();
    return { ok: false, error: 'Pause and stop cannot share a shortcut.' };
  }

  const previous = settings.values[key];
  settings.update({ [key]: accelerator });
  const result = registerHotkeys();

  const took = which === 'stop' ? result.stopped : result.paused;
  if (!took) {
    // Another application already owns it. Put the old one back rather than
    // leaving the user with a shortcut that silently does nothing.
    settings.update({ [key]: previous });
    registerHotkeys();
    return { ok: false, error: 'Another application is already using that '
                             + 'combination. Kept the previous one.' };
  }

  log.info(`hotkey ${which} rebound to ${accelerator}`);
  return { ok: true, state: hotkeyState() };
});

ipcMain.handle('settings:get', () => settings.values);

ipcMain.handle('settings:set', (_e, patch) => settings.update(patch));

ipcMain.handle('settings:chooseTemplate', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose an SOP template',
    filters: [{ name: 'Templates', extensions: ['docx', 'md', 'html', 'txt'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };

  // Report what the template declares, so a broken one is caught when it is
  // chosen rather than at export time.
  let inspection = null;
  try {
    inspection = r.filePaths[0].toLowerCase().endsWith('.docx')
      ? await docx.inspect(r.filePaths[0])
      : templating.inspect(fs.readFileSync(r.filePaths[0], 'utf8'));
  } catch (err) {
    return { ok: false, error: `Could not read that template: ${err.message}` };
  }

  return {
    ok: true,
    values: settings.update({ templatePath: r.filePaths[0] }),
    inspection,
  };
});

ipcMain.handle('settings:chooseLogo', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Choose a logo for exports',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'svg'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  return { ok: true, values: settings.update({ brandLogo: r.filePaths[0] }) };
});

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
  if (!session) return null;
  const abs = paths.safeJoin(session.dir, screenshot);
  return abs && fs.existsSync(abs) ? 'bsr://step/' + encodeURIComponent(abs) : null;
});
