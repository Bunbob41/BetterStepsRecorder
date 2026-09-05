const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell, globalShortcut, screen } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { Sidecar } = require('./sidecar');
const { Session } = require('./session');
const { Settings } = require('./settings');
const log = require('./log');
const { buildHtml, buildMarkdown, copyImages } = require('./export');
const templating = require('./template');
const docx = require('./docx');
const templatesLib = require('./templates-lib');
const shortcuts = require('./shortcuts');
const bounds = require('./bounds');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..', '..');

let win = null;
let sidecar = null;
let session = null;
let settings = null;

// Scope chosen for the next recording: [] means everything.
let scopePids = [];
let scopeLabel = 'Everything';
let recordingPaused = false;

// Undo history for destructive edits, newest last. Session-scoped: it exists to
// cover a slip during editing, not to be a document revision system.
let undoStack = [];
const UNDO_LIMIT = 25;

function pushUndo(entry) {
  undoStack.push(entry);
  while (undoStack.length > UNDO_LIMIT) {
    // Once an entry can no longer be undone, its stashed original is just a
    // copy of redacted pixels sitting on disk. Drop the file with the entry.
    const dropped = undoStack.shift();
    for (const t of tokensOf(dropped)) if (session) session.discard(t);
  }
  send('undo:depth', { depth: undoStack.length });
}

function tokensOf(entry) {
  if (!entry) return [];
  if (entry.type === 'deleteMany') return entry.removals.map((r) => r.token).filter(Boolean);
  return entry.token ? [entry.token] : [];
}

/** Closes the current session: history goes, and so do the stashed originals. */
function closeSession() {
  if (session) session.purgeTrash();
  undoStack = [];
  send('undo:depth', { depth: 0 });
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

  // A monitor unplugged mid-session can leave the window off-screen entirely.
  screen.on('display-removed', () => fitToDisplay(win));
  screen.on('display-metrics-changed', () => fitToDisplay(win));
}

function wireSidecar() {
  sidecar = new Sidecar();

  sidecar.on('ready', (m) => send('sidecar:ready', m));
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

    if (!session || !target.startsWith(path.normalize(session.dir))) {
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

  const paused = globalShortcut.register(wanted.pause, () => {
    if (!sidecar || !sidecar.running) return;
    recordingPaused = !recordingPaused;
    if (recordingPaused) sidecar.pause(); else sidecar.resume();
    log.info(`hotkey: ${recordingPaused ? 'paused' : 'resumed'}`);
    send('hotkey', { action: recordingPaused ? 'paused' : 'resumed' });
  });

  const stopped = globalShortcut.register(wanted.stop, () => {
    // Restore first and unconditionally. Gating this on the engine still
    // running is how the window got stranded as a strip with no way back.
    leaveCompact();
    if (!sidecar || !sidecar.running) return;
    recordingPaused = false;
    sidecar.stop();
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

ipcMain.handle('templates:list', () =>
  templatesLib.list(PROJECT_ROOT, app.getPath('userData')));

ipcMain.handle('templates:reveal', () => {
  shell.openPath(templatesLib.userDir(app.getPath('userData')));
  return { ok: true };
});

ipcMain.handle('recording:start', async (_e, intent = {}) => {
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
});

// The renderer calls this whenever it believes recording has ended. Compact
// mode is a property of the UI, so it must not be exitable only through paths
// that happen to know about the capture engine.
ipcMain.handle('ui:restore', () => { leaveCompact(); return { ok: true }; });

ipcMain.handle('recording:pause',  () => { recordingPaused = true;  sidecar.pause();  return { ok: true }; });
ipcMain.handle('recording:resume', () => { recordingPaused = false; sidecar.resume(); return { ok: true }; });

ipcMain.handle('recording:stop', () => {
  recordingPaused = false;
  leaveCompact();
  sidecar.stop();
  return { ok: true, steps: session ? session.steps.length : 0 };
});

ipcMain.handle('session:get', () => ({
  dir: session ? session.dir : null,
  steps: session ? session.steps : [],
  purpose: session ? session.purpose : 'sop',
  templatePath: session ? session.templatePath : '',
}));

ipcMain.handle('step:addNote', (_e, { text, afterId }) =>
  session ? session.addNote(text, afterId) : null);

ipcMain.handle('step:update', (_e, { id, patch }) =>
  session ? session.updateStep(id, patch) : null);

ipcMain.handle('step:remove', (_e, { id }) => {
  if (!session) return false;
  const removed = session.removeStep(id);
  if (!removed) return false;
  pushUndo({ type: 'delete', ...removed });
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

  pushUndo({ type: 'deleteMany', removals });
  return { ok: true, removed: removals.length, steps: session.steps };
});

ipcMain.handle('edit:undo', () => {
  if (!session || !undoStack.length) return { ok: false, empty: true };
  const entry = undoStack.pop();
  send('undo:depth', { depth: undoStack.length });

  if (entry.type === 'delete') {
    if (entry.token) session.restore(entry.token, entry.step.screenshot);
    session.insertAt(entry.index, entry.step);
    return { ok: true, action: 'delete', steps: session.steps };
  }

  if (entry.type === 'deleteMany') {
    // Reverse order, so each index means what it meant when that step was cut.
    for (const r of [...entry.removals].reverse()) {
      if (r.token) session.restore(r.token, r.step.screenshot);
      session.insertAt(r.index, r.step);
    }
    return { ok: true, action: 'deleteMany', steps: session.steps };
  }

  if (entry.type === 'redact') {
    if (!session.restore(entry.token, entry.step.screenshot)) {
      return { ok: false, error: 'The original screenshot is no longer available.' };
    }
    session.updateStep(entry.step.id, {
      redacted: entry.wasRedacted || false,
      editedAt: new Date().toISOString(),
    });
    return { ok: true, action: 'redact', steps: session.steps };
  }

  return { ok: false };
});

ipcMain.handle('edit:undoDepth', () => ({ depth: undoStack.length }));

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

  // Keep the pre-blur image so the edit can be undone. Blur destroys pixels by
  // design; that is only defensible if a slip is recoverable while the session
  // is open.
  const token = session.stash(step.screenshot);

  // Write beside the original and rename over it, so an interrupted write
  // cannot leave a truncated screenshot where a real one used to be. A locked
  // or read-only file must come back as an error, not as a rejected promise
  // the renderer swallows in a mouse handler.
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

  // Recorded only now: a redaction that failed must not occupy an undo slot.
  pushUndo({ type: 'redact', step: { ...step }, token, wasRedacted: step.redacted === true });

  const updated = session.updateStep(id, {
    redacted: true,
    editedAt: new Date().toISOString(),
  });

  log.info(`redacted step ${id}`);

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
  const templateForSession = session.templatePath || settings.values.templatePath || '';
  if (format === 'template' && !templateForSession) {
    return { ok: false, error: 'This recording has no template. Choose one in Settings.' };
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
      // than a document that breaks the moment it is emailed on its own.
      fs.writeFileSync(out, buildHtml(session, {
        title: safeTitle, embedImages: true, brand, voice: voiceFor(session),
      }), 'utf8');

    } else if (format === 'md') {
      const imageDir = `${path.basename(out, '.md')}-images`;
      const copied = copyImages(session, path.join(path.dirname(out), imageDir));
      fs.writeFileSync(out, buildMarkdown(session, {
        title: safeTitle, imageDir, brand, voice: voiceFor(session),
      }), 'utf8');
      log.info(`markdown export copied ${copied} images`);

    } else if (format === 'pdf') {
      await exportPdf(safeTitle, out, brand);

    } else if (format === 'template') {
      const tpl = templateForSession;
      if (!fs.existsSync(tpl)) {
        return { ok: false, error: `The template is no longer at ${tpl}` };
      }

      // Word templates go through their own renderer: a .docx is a zip of XML
      // parts, and Word splits a typed placeholder across runs, so it cannot be
      // filled by string replacement the way a Markdown file can.
      if (tpl.toLowerCase().endsWith('.docx')) {
        const { buffer, missing } = await docx.render(tpl, session, {
          title: safeTitle,
          brand,
          redactionSummary: templating.redactionSummary(session.steps),
        });
        fs.writeFileSync(out, buffer);
        log.info(`docx export: ${(buffer.length / 1024).toFixed(0)}KB, `
                 + `${missing.length} missing images`);
        return {
          ok: true,
          file: out,
          warning: missing.length
            ? `${missing.length} screenshot(s) were missing and left out`
            : null,
        };
      }

      // Read, never written: the organisation's format is the one thing this
      // feature must not alter.
      const source = fs.readFileSync(tpl, 'utf8');
      const imageDir = `${path.basename(out, path.extname(out))}-images`;
      const { text, report } = templating.render(source, session, {
        title: safeTitle, imageDir, brand,
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
  const html = buildHtml(session, {
    title, embedImages: true, brand, voice: voiceFor(session),
  });
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
ipcMain.handle('library:list', () => {
  const root = settings.values.saveRoot;
  if (!fs.existsSync(root)) return [];

  const entries = [];
  for (const name of fs.readdirSync(root)) {
    const dir = path.join(root, name);
    const meta = path.join(dir, 'session.json');
    if (!name.startsWith('session-') || !fs.existsSync(meta)) continue;

    try {
      const data = JSON.parse(fs.readFileSync(meta, 'utf8'));
      const steps = data.steps || [];
      entries.push({
        dir,
        name: data.name || '',
        steps: steps.filter((s) => s.action !== 'note').length,
        savedAt: data.savedAt || null,
        // Recorded from the first step that names one, so the card says what
        // the recording is actually about.
        app: (steps.find((s) => s.window && s.window.process) || {}).window?.process || '',
      });
    } catch { /* a half-written session is skipped, not fatal */ }
  }

  return entries.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
});

ipcMain.handle('library:open', (_e, { dir }) => {
  if (!dir || !fs.existsSync(path.join(dir, 'session.json'))) {
    return { ok: false, error: 'That recording is no longer there.' };
  }
  closeSession();
  session = Session.load(dir);
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

  const checkable = session.steps.filter((s) => s.action !== 'note');
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

ipcMain.handle('shortcuts:set', (_e, { which, accelerator }) => {
  const key = which === 'stop' ? 'hotkeyStop' : 'hotkeyPause';

  // Blank restores the default rather than leaving the action unreachable.
  if (!accelerator) {
    settings.update({ [key]: '' });
    return { ok: true, ...registerHotkeys(), state: hotkeyState() };
  }

  if (!shortcuts.isValid(accelerator)) {
    return { ok: false, error: 'That needs a modifier — Ctrl, Alt or Shift — '
                             + 'or a function key on its own.' };
  }

  const other = which === 'stop' ? 'hotkeyPause' : 'hotkeyStop';
  const resolved = shortcuts.resolve(settings.values);
  if (accelerator === (which === 'stop' ? resolved.pause : resolved.stop)) {
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
  if (!session || !screenshot) return null;
  const abs = path.join(session.dir, screenshot);
  return fs.existsSync(abs) ? 'bsr://step/' + encodeURIComponent(abs) : null;
});
