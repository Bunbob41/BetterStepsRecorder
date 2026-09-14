/**
 * The invariants ENGINEERING.md claims, checked against the code.
 *
 * Static, like renderer_wiring_test.js, and for the same reason: these are
 * properties that hold across files rather than inside one, so no unit test is
 * positioned to notice when one stops holding. An undo entry pushed with a type
 * nothing handles, a screenshot written without being stashed first, a new
 * place that counts steps by "not a note" and so counts headings — each is a
 * silent defect, and each is a grep away from being caught.
 *
 * These check SHAPE, not behaviour. A passing run means nothing here has
 * drifted; it does not mean the behaviour is right, which is what every other
 * suite is for.
 */
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + n); return; }
  fail++;
  console.log('  FAIL ' + n + (detail ? '\n        ' + detail : ''));
};

const main = read('ui/src/main/main.js');
const exportJs = read('ui/src/main/export.js');
const renderer = read('ui/src/renderer/renderer.js');
const preload = read('ui/src/main/preload.js');
const history = read('ui/src/main/history.js');

/**
 * Every module that could count steps, found rather than listed.
 *
 * The listed version named three files and missed `library.js`, which had been
 * counting headings as steps since headings existed. A check that has to be
 * remembered is a check that will be forgotten.
 */
function sourceFiles() {
  const roots = ['ui/src/main', 'ui/src/renderer'];
  const out = [];
  for (const root of roots) {
    const dir = path.join(__dirname, '..', root);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push([`${root}/${f}`, read(`${root}/${f}`)]);
    }
  }
  return out;
}

console.log('every undo entry can actually be undone:');
{
  // An entry whose type nothing matches falls through to a refusal — the user
  // presses Ctrl+Z and nothing happens, with no error and the entry consumed.
  // The types are pushed in main.js and applied in history.js, so neither file
  // can be checked on its own.
  // pushPatch in history.js builds the entries for field changes, so the types
  // it builds count as pushed as well as main's own pushUndo calls.
  const pushed = [...main.matchAll(/pushUndo\(\{\s*\n?\s*type: '(\w+)'/g)].map((m) => m[1])
    .concat([...history.matchAll(/const entry = \{ type: '(\w+)'/g)].map((m) => m[1]));
  const handled = [...history.matchAll(/case '(\w+)':/g)].map((m) => m[1]);

  check(`there are undo types to check (${pushed.length})`, pushed.length >= 4);
  for (const t of new Set(pushed)) {
    check(`'${t}' is applied`, handled.includes(t),
          `main.js pushes '${t}' and history.js never matches it`);
  }

  // The one exception: a deletion's opposite is pushed by nothing, because it
  // only ever comes back OUT of applying one.
  const inverseOnly = new Set(['removeSteps']);
  const dead = handled.filter((t) => !pushed.includes(t) && !inverseOnly.has(t));
  check('and nothing is applied that nothing produces', dead.length === 0, dead.join());
}

console.log('\nundo and redo are the same code:');
{
  // The whole design: applying an entry returns the entry that puts it back.
  // A branch that returns no inverse is a dead end - undo would work once and
  // redo would silently do nothing.
  const cases = [...history.matchAll(/case '(\w+)': \{([\s\S]*?)\n    \}/g)];
  check(`every branch was found (${cases.length})`, cases.length >= 4);
  for (const [, name, body] of cases) {
    check(`'${name}' returns the entry that puts it back`, /inverse:/.test(body),
          `history.js case '${name}' produces no inverse, so it cannot be redone`);
  }

  // And there is one traversal, used both ways, rather than two.
  check('undo and redo share one implementation',
        /undo\(session\) \{ return this\.#move/.test(history)
        && /redo\(session\) \{ return this\.#move/.test(history));
}

console.log('\na stashed screenshot is always released:');
{
  // tokensOf feeds session.discard() when an entry falls off the end of the
  // stack. An entry holding its token in a shape tokensOf cannot see leaks the
  // file for the rest of the session.
  const at = history.indexOf('function tokensOf');
  const body = history.slice(at, history.indexOf('}', history.indexOf('return entry.token')));

  check('the collective shape is special-cased', /removals/.test(body));
  check('and every other shape is read generically', /entry\.token/.test(body));

  // So the only way to leak is an entry that stashes but names its token
  // something else.
  const odd = [...main.matchAll(/pushUndo\(\{[^}]*?(stashToken|tokens)\s*:/g)];
  check('the collective shape names its own', /restoreSteps/.test(body));
  check('no entry names its token something tokensOf cannot see', odd.length === 0);
}

console.log('\nthe bridge is wired end to end:');
{
  const exposed = [...preload.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([\w:]+)'/g)].map((m) => m[1]);
  const handled = [...main.matchAll(/ipcMain\.handle\('([\w:]+)'/g)].map((m) => m[1]);

  const missing = invoked.filter((c) => !handled.includes(c));
  check('every channel the bridge invokes has a handler', missing.length === 0,
        'no handler for: ' + missing.join());

  const unreachable = handled.filter((c) => !invoked.includes(c));
  check('and no handler is unreachable', unreachable.length === 0,
        'nothing invokes: ' + unreachable.join());

  const called = [...new Set([...renderer.matchAll(/window\.bsr\.(\w+)/g)].map((m) => m[1]))];
  const undefinedCalls = called.filter((u) => !exposed.includes(u));
  check('every bsr.* the page calls is exposed', undefinedCalls.length === 0,
        'not on the bridge: ' + undefinedCalls.join());

  // The other direction, which nothing checked. An invoke that goes nowhere
  // throws where somebody sees it; a send that goes nowhere is silent - the
  // window simply never hears about it, which is the same shape as the feature
  // not working and gives no clue why.
  const sent = [...new Set([...main.matchAll(/\bsend\('([\w:]+)'/g)].map((m) => m[1]))];
  const heard = [...preload.matchAll(/ipcRenderer\.on\('([\w:]+)'/g)].map((m) => m[1]);
  const unheard = sent.filter((c) => !heard.includes(c));
  check('every channel main pushes is listened for', unheard.length === 0,
        'nobody listens for: ' + unheard.join());
}

console.log('\na recording nobody named is named after what it recorded:');
{
  // The name is the heading of an exported guide and the caption under every
  // figure in it, so getting this wrong is not cosmetic.
  const at = main.indexOf('function finishRecording');
  const body = main.slice(at, main.indexOf('\n}', at) + 2);

  check('the naming happens when the recording stops', /appName\.label\(/.test(body));
  check('and that generated name is what the stop renames to',
        /const named = appName\.label\(/.test(body) && /session\.rename\(named\)/.test(body));
  // The label may be CONSULTED before the stop - carrying a recording on
  // compares the name it already has against it, to work out whether a person
  // ever typed one - but a recording is never NAMED from it early, because at
  // the start there are no steps to be named after.
  check('and a name is never generated from steps anywhere else',
        !/rename\(\s*appName\.label/.test(main));
  check('only when the name is still the one this application chose',
        /session\.name === autoNamedAs/.test(body));
  check('and what the application chose is never written to the recording',
        !/autoNamedAs/.test(read('ui/src/main/session.js')));
  check('the window is told, so the name shows in the box it is typed into',
        /send\('session:renamed'/.test(body));
}

// The engine numbers screenshots 0001, 0002 ... from zero on every run. Two
// recordings into one folder therefore means the second one writing over the
// first one's pictures - silently, because nothing fails.
console.log('\na recording carried on does not overwrite what it already has:');
{
  const at = main.indexOf('async function beginRecording');
  const body = main.slice(at, main.indexOf('\nipcMain.handle(\'recording:start\'', at));

  check('carrying on reuses the folder that is open', /dir = session\.dir/.test(body));
  check('and makes no new session while doing it',
        /} else {[\s\S]*new Session\(dir\)/.test(body));
  check('the engine is told where the numbering is up to',
        /seqFrom: resuming \? session\.lastShotSeq\(\) : 0/.test(body));
  // Read off the folder, not counted from the steps: a deleted step leaves a
  // gap and counting would reuse a number already written.
  check('and that number is read off the folder',
        /readdirSync\(path\.join\(this\.dir, 'steps'\)\)/
          .test(read('ui/src/main/session.js')));
  check('the engine never lets it go backwards',
        /_seq = Math\.Max\(0, seqFrom\)/.test(read('capture/Recorder.cs')));
  // Nothing is discarded on the way back in: the trash, the undo stack and the
  // steps already recorded all belong to the recording being continued.
  const resumingHalf = body.slice(0, body.indexOf('} else {'));
  check('carrying on does not clear the recording it is adding to',
        resumingHalf.length > 0 && !resumingHalf.includes('closeSession()'));
}

console.log('\nnothing is recorded that the person did not ask for:');
{
  const at = main.indexOf('async function beginRecording');
  const body = main.slice(at, main.indexOf("\nipcMain.handle('recording:start'", at));

  // The scope is the privacy-bearing part. Carried on, it must come from the
  // recording - the module-level variables hold whatever the last start left,
  // which after a restart is an empty list, and empty means record everything.
  check('carrying on takes the scope from the recording, not from last time',
        /const remembered = session\.scope/.test(body));
  check('and refuses rather than widening when the program is gone',
        /if \(!scopePids\.length\)[\s\S]{0,400}return \{ ok: false/.test(body));
  check('a recording too old to know says so instead of guessing',
        /predates remembered scopes/.test(body));
  check('the scope is written down while the programs can still be asked',
        /session\.setScope\(\{ label: scopeLabel, processes: await processesFor/.test(body));
  check('and it is named by program, never by process id',
        /processes: \(processes \|\| \[\]\)/.test(read('ui/src/main/session.js')));

  // Two recordings at once share one engine, one clock and one folder.
  check('a second recording cannot start on top of a first',
        /if \(recordingSince\) \{[\s\S]{0,160}already being recorded/.test(body));
  check('and pausing is refused when nothing is recording',
        /'recording:pause'[\s\S]{0,400}if \(!recordingSince\) return \{ ok: false/.test(main));
  check('as it is in the window', /if \(state === 'idle'\) return;/.test(renderer));
}

console.log('\na screenshot number is never handed out twice:');
{
  const sessionJs = read('ui/src/main/session.js');
  // Deleting a step unlinks its picture, so the folder alone forgets - and the
  // undo that can put that picture back outlives carrying the recording on.
  check('the mark is remembered rather than only counted off the folder',
        /noteShot\(relative\)/.test(sessionJs)
        && /shotSeq: this\.shotSeq/.test(sessionJs));
  check('every step the engine records raises it',
        /this\.noteShot\(step\.screenshot\);/.test(sessionJs));
  check('and the folder can only ever raise it, never lower it',
        /let top = Number\.isSafeInteger\(this\.shotSeq\) \? this\.shotSeq : 0;/
          .test(sessionJs));
  check('a number too large to send survives as no number at all, so it is refused',
        /Number\.isSafeInteger\(n\) && n > top/.test(sessionJs));
}

console.log('\nan engine on its way out is not offered to a new recording:');
{
  const sc = read('ui/src/main/sidecar.js');
  check('stopping is a state of its own', /get stopping\(\)/.test(sc));
  check('and an engine in it does not read as running',
        /return this\.#proc !== null && !this\.#stopping;/.test(sc));
  check('a recording waits for it to go before starting another',
        /if \(sidecar\.stopping\) \{/.test(main));
  check('and stops waiting rather than hanging', /setTimeout\(resolve, 4000\)/.test(main));
}

console.log('\na recording can be put away:');
{
  const at = main.indexOf("ipcMain.handle('session:close'");
  const body = main.slice(at, main.indexOf('\n});', at));
  // Closing mid-recording would pull the folder out from under the engine.
  check('closing is refused while something is recording',
        /if \(recordingSince\) return \{ ok: false/.test(body));
  // Really closed, not only in the window: Continue carries on whatever main
  // has open, so a recording closed only in the window could still be resumed.
  check('and closes it in main, not only on screen', /session = null;/.test(body));
  // Two ways to stop, one way to finish.
  check('the strip and the stop hotkey finish a recording the same way',
        /async function stopRecording\(\) \{[\s\S]{0,120}recordingFinished\(\)/.test(renderer)
        && /action === 'stopped'\) recordingFinished\(\)/.test(renderer));
}

console.log('\nthe end of a recording is written down:');
{
  // Only the start was ever logged, so every recording in the log trailed off
  // and "why did it cut out?" had no answer.
  check('there is one place that records the ending',
        /function logRecordingEnd\(reason\)/.test(main));
  check('it is silent when nothing was being recorded',
        /if \(!recordingSince\) return;/.test(main));
  check('the clock starts only once recording is genuinely under way',
        main.indexOf('recordingSince = Date.now();') > main.indexOf('if (!started)'));

  // Every way a recording can end has to say so, or the one that goes
  // unrecorded is the one that gets asked about.
  for (const [what, near] of [
    ['the Stop button', "finishRecording('the Stop button')"],
    ['the stop hotkey', "finishRecording('the stop hotkey')"],
    ['the engine exiting', 'the capture engine exited (code'],
    ['a fatal engine error', 'the engine reported ${m.code}'],
    ['the application quitting', "logRecordingEnd('the application quit')"],
  ]) {
    check(`${what} says so`, main.includes(near), near);
  }
  check('and pausing is told apart from stopping',
        /log\.info\('recording paused'\)/.test(main));
}

console.log('\nscreenshots are sized for the page they are going on:');
{
  const at = main.indexOf('const PAGE_WIDTH');
  check('a LaTeX export sizes its pictures', at > 0);

  // Sizing after the marker is drawn shrinks the marker with the picture it is
  // on. Sizing before would draw a marker for a picture that no longer exists.
  check('after the marker is drawn into them',
        main.indexOf('marks.images', at) > at);
  // The names come from the bytes: gather first and the .png names would be
  // handed to files that are now .jpg, and every figure would be an empty box.
  check('and before the names are decided',
        at < main.indexOf('gatherImages({ files: shotFiles(session), images: forPage })'));
  check('the recording itself keeps its full-size screenshots',
        !/rewriteScreenshot|writeFileSync/.test(
          main.slice(at, main.indexOf('const imagesDir', at))));
}

console.log('\nexcluded steps do not leak into a document:');
{
  check('images are copied from exportable(), not from every step',
        /for \(const step of exportable\(session\)\)/.test(exportJs));
  check('and exportable() drops them first',
        /filter\(\(s\) => !s\.excluded\)/.test(exportJs));
}

console.log('\na screenshot is never written except atomically:');
{
  const at = main.indexOf('function rewriteScreenshot');
  // To the end of the function, not a fixed number of characters. The window
  // used to be `at + 1000`, so adding a comment to the top of the function
  // pushed the code it checks out of view and three invariants went red
  // without anything about them changing.
  const body = main.slice(at, main.indexOf('\n}', at) + 2);

  check('it writes beside the original and renames over it',
        /\.tmp/.test(body) && /renameSync/.test(body));
  check('it stashes the old pixels before writing the new',
        body.indexOf('stash(') < body.indexOf('writeFileSync'));
  check('and gives the stash back if the write fails', /discard\(token\)/.test(body));

  // Anything else writing a screenshot path would bypass all three.
  const direct = [...main.matchAll(/writeFileSync\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((a) => /step\.screenshot|shotPath/.test(a));
  check('nothing else writes a screenshot directly', direct.length === 0, direct.join());
}

console.log('\nno screenshot is written or edited behind the sharing rules:');
{
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const recorder = fs2.readFileSync(
    path2.join(__dirname, '..', 'capture', 'Recorder.cs'), 'utf8');

  // There are two moments a picture can be taken now: at the press, into a
  // temporary file, and at the release when the press was missed. Both have to
  // end up in the one place that decides whether a file is worth keeping - a
  // site that skipped it would write duplicates again, silently.
  const direct = [...recorder.matchAll(/ScreenCapture\.CaptureTo\(/g)];
  check('the engine captures in two places and no more', direct.length === 2,
        `${direct.length} direct calls to CaptureTo`);
  {
    const from = recorder.indexOf('private void PrepareFrom');
    const prep = recorder.slice(from, recorder.indexOf('\n    }\n', from));
    check('one of them is the press', from > 0 && /ScreenCapture\.CaptureTo\(/.test(prep));
    // The copy taken inside the hook is what the press prefers; capturing at
    // the worker is only for when it cannot supply the frame.
    check('and the press prefers the pixels copied before the click',
          prep.indexOf('SaveCrop') > 0 && prep.indexOf('SaveCrop') < prep.indexOf('ScreenCapture.CaptureTo('));
  }
  check('and the other is the one that captures at the release',
        /CaptureOrReuse[\s\S]{0,600}ScreenCapture\.CaptureTo\(/.test(recorder));
  // Both routes end at Settle, which owns the comparison and the shared file.
  check('both routes settle through the same rule',
        /CaptureOrReuse[\s\S]{0,400}return Settle\(/.test(recorder)
        && /AdoptOrReuse[\s\S]{0,900}return Settle\(/.test(recorder));
  check('and only that rule remembers the last picture',
        [...recorder.matchAll(/_lastShot = bytes/g)].length === 1);
  check('a re-record is never deduplicated',
        /mayReuse: replaces is null/.test(recorder));

  // And the window copies before it writes, or a blur changes two steps.
  const at2 = main.indexOf('function rewriteScreenshot');
  const body2 = main.slice(at2, main.indexOf('\n}', at2) + 2);
  check('the window gives a step its own copy before writing pixels',
        body2.indexOf('forkScreenshot') < body2.indexOf('writeFileSync'));
}

console.log('\na step is made of what was on screen at the press:');
{
  const fsp = require('node:fs');
  const pathp = require('node:path');
  const rec = fsp.readFileSync(
    pathp.join(__dirname, '..', 'capture', 'Recorder.cs'), 'utf8');
  const hook = fsp.readFileSync(
    pathp.join(__dirname, '..', 'capture', 'MouseHook.cs'), 'utf8');

  // Measured before this existed: the picture, the window and the name were
  // all resolved 60-260ms after the click had been delivered. Long enough for
  // a menu to open over the control - so the menu went into the picture of the
  // step that opened it - and long enough for a dialog dismissed by the click
  // to be gone, which left steps reading "Clicked" with no window at all.
  const down = hook.slice(hook.indexOf('WM_LBUTTONDOWN'), hook.indexOf('WM_LBUTTONUP'));
  check('the hook takes a press on the way down', /Press\(data\.pt, now\)/.test(down));
  check('and on the way down for the right button too',
        /WM_RBUTTONDOWN[\s\S]{0,200}Press\(data\.pt, now\)/.test(hook));
  check('but a press never consumes a single-shot re-record',
        /internal bool OfferPress[\s\S]{0,400}RecordingOnce\) return false;/.test(rec)
        && !/internal bool OfferPress[\s\S]{0,400}State = RecordingState\.Paused/.test(rec));

  // The screen is copied INSIDE the hook: the one moment Windows guarantees
  // comes before the application sees the click. A picture taken on the worker
  // even a few milliseconds later showed tabs already switched.
  const press = hook.slice(hook.indexOf('private void Press('),
                           hook.indexOf('\n    }\n', hook.indexOf('private void Press(')));
  check('the screen is copied inside the hook', /PressShots\.Take\(/.test(press));
  check('and only while a recording wants it',
        press.indexOf('WantsPress') >= 0 && press.indexOf('WantsPress') < press.indexOf('PressShots.Take('));
  // Anything that can wait on another process does not belong in a hook: a hook
  // that blocks is evicted, silently, for the whole desktop.
  check('nothing in the hook can wait on another application',
        !/RootWindowAt|WindowFromPoint|UiaResolver|\.Save\(|File\./.test(press));
  check('a copy the hook did not hand over is given back', /shot\?\.Release\(\)/.test(press));

  const shots = fsp.readFileSync(pathp.join(__dirname, '..', 'capture', 'PressShot.cs'), 'utf8');
  check('a copy that is too slow switches press copies off', /_disabled = true/.test(shots));
  check('and nothing is written from inside the hook to say so',
        !/Protocol\./.test(shots));
  check('the worker always gives the pixels back',
        /try \{ PrepareFrom\(p\); \}\s*finally \{ p\.Shot\?\.Release\(\); \}/.test(rec));

  // Framed as a sliver, a dropdown came out 224x51 with nothing around it.
  check('a menu or a dropdown is framed as the window it belongs to',
        /FrameWindowFor\(under, p\.Foreground\)/.test(rec));
  check('and widened to take the popup in', /Including\(bounds, under\)/.test(rec));

  const mainSrc = fsp.readFileSync(pathp.join(__dirname, '..', 'ui', 'src', 'main', 'main.js'), 'utf8');
  const enter = mainSrc.slice(mainSrc.indexOf('function enterCompact'), mainSrc.indexOf('function leaveCompact'));
  const leave = mainSrc.slice(mainSrc.indexOf('function leaveCompact'),
                              mainSrc.indexOf('\n}\n', mainSrc.indexOf('function leaveCompact')));
  check('the recording strip is left out of every screen copy', /setContentProtection\(true\)/.test(enter));
  check('and put back in afterwards, or it vanishes from screen shares',
        /setContentProtection\(false\)/.test(leave));

  // What the release does with it. Each of these is a field that used to be
  // read after the click and now comes from before it.
  const body = rec.slice(rec.indexOf('private void Process(RawEvent'),
                         rec.indexOf('Protocol.Emit(step)', rec.indexOf('private void Process(RawEvent')));
  check('the release looks for the press first',
        body.indexOf('TakePending') < body.indexOf('RootWindowAt'));
  check('the window comes from the press', /pre\?\.Window \?\?/.test(body));
  check('the frame comes from the press', /pre\?\.Bounds \?\?/.test(body));
  check('the name comes from the press', /pre is not null \? pre\.Target/.test(body));
  check('and so does the picture', /AdoptOrReuse\(pre/.test(body));

  // A picture taken for a press that never became a step is a file in
  // somebody's recording folder that nothing refers to.
  const discards = [...rec.matchAll(/\.Discard\(\)/g)].length;
  check(`an unused press is always discarded (${discards} places)`, discards >= 4);
  check('including when the release lands out of scope',
        /InScope[\s\S]{0,120}pre\?\.Discard\(\)/.test(body));
}

console.log('\nan engine problem does not end a recording it has not ended:');
{
  const fsE = require('node:fs');
  const pathE = require('node:path');
  const mainE = fsE.readFileSync(pathE.join(__dirname, '..', 'ui', 'src', 'main', 'main.js'), 'utf8');

  // Recording a full-screen game: one slow screen copy was reported as an
  // error, and every error brought the editor back over the game, raised a
  // blocking alert and showed the recording as stopped - while the engine went
  // on recording. Nothing was written to the log, so it left no trace.
  const onError = mainE.slice(mainE.indexOf("sidecar.on('error'"), mainE.indexOf("sidecar.on('warning'"));
  check('the error handler was found', onError.length > 40, `${onError.length} characters`);
  check('every engine error is written to the log', /log\.error\(/.test(onError));
  check('the window comes back only for an error the recording cannot survive',
        onError.indexOf('isFatal(m.code)') >= 0
        && onError.indexOf('leaveCompact()') > onError.indexOf('isFatal(m.code)')
        && onError.indexOf('return;') > onError.indexOf('leaveCompact()'));
  check('and a warning is logged, never shown as an error',
        /sidecar\.on\('warning', \(m\) => log\.warn/.test(mainE));

  const recE = fsE.readFileSync(pathE.join(__dirname, '..', 'capture', 'Recorder.cs'), 'utf8');
  check('a slow screen copy is a warning, not an error',
        /Protocol\.Warn\("PRESS_COPY_SLOW"/.test(recE) && !/Protocol\.Error\("PRESS_COPY_SLOW"/.test(recE));

  const shotE = fsE.readFileSync(pathE.join(__dirname, '..', 'capture', 'PressShot.cs'), 'utf8');
  check('a full-screen window is ruled out before any pixels are copied',
        shotE.indexOf('FillsMonitor(fg') > 0 && shotE.indexOf('FillsMonitor(fg') < shotE.indexOf('pixels = Borrow('));
  check('and deciding that cannot wait on the application',
        !/GetWindowText|WindowFromPoint|SendMessage/.test(shotE));
}

console.log('\na program the recorder cannot see is said out loud:');
{
  const fsB = require('node:fs');
  const pathB = require('node:path');
  const readB = (...p) => fsB.readFileSync(pathB.join(__dirname, '..', ...p), 'utf8');
  const recB = readB('capture', 'Recorder.cs');
  const mainB = readB('ui', 'src', 'main', 'main.js');
  const preB = readB('ui', 'src', 'main', 'preload.js');
  const rendB = readB('ui', 'src', 'renderer', 'renderer.js');
  const htmlB = readB('ui', 'src', 'renderer', 'index.html');
  const cssB = readB('ui', 'src', 'renderer', 'styles.css');

  // HYPACK started with Run as administrator: two recordings with no HYPACK
  // steps in them, no error, nothing in the log.
  check('the idle tick watches the program in front', /AbandonStalePress\(\);\s*WatchForeground\(\);/.test(recB));
  check('and asks about a program only when the program in front changes', /if \(pid == _frontPid\) return;/.test(recB));
  check('a program outside the recording\'s scope is not warned about',
        /InScope\(pid\) && Privilege\.CannotSee\(pid\)/.test(recB));
  check('it is written to the log', /sidecar\.on\('blocked'[\s\S]{0,300}log\.warn/.test(mainB));
  check('and passed to the window', /sidecar\.on\('blocked'[\s\S]{0,400}send\('capture:blocked', m\)/.test(mainB));
  check('which the bridge exposes', /onBlocked: \(fn\) => ipcRenderer\.on\('capture:blocked'/.test(preB));
  check('the strip has a place for it', /id="c-blocked"/.test(htmlB));
  check('that cannot wrap and push Pause and Stop out of the strip',
        /\.c-blocked \{[\s\S]*?white-space: nowrap;[\s\S]*?text-overflow: ellipsis;/.test(cssB));
  check('and the warning clears when recording stops', /if \(next === 'idle'\) paintBlocked\(null\);/.test(rendB));
}

console.log('\nthe control is asked about in its window\'s own terms:');
{
  const fsU = require('node:fs');
  const pathU = require('node:path');
  const uia = fsU.readFileSync(pathU.join(__dirname, '..', 'capture', 'UiaResolver.cs'), 'utf8');
  const recU = fsU.readFileSync(pathU.join(__dirname, '..', 'capture', 'Recorder.cs'), 'utf8');

  // On a display at 125%, HYPACK's Tracklines tab was named "Charts": the
  // question was asked in this process's per-monitor terms about a window that
  // draws at 96 dpi.
  check('the lookup goes through the window\'s terms', /InWindowTerms<TargetInfo\?>\(window/.test(uia));
  check('the thread takes the window\'s DPI mode before asking',
        /SetThreadDpiAwarenessContext\(context\)/.test(uia));
  check('and is given the point in that window\'s coordinates',
        /PhysicalToLogicalPointForPerMonitorDPI\(window, ref point\)/.test(uia));
  check('and the thread\'s mode is put back whatever happens',
        /finally \{ if \(previous != IntPtr\.Zero\) Win32\.SetThreadDpiAwarenessContext\(previous\); \}/.test(uia));
  const calls = [...recU.matchAll(/UiaResolver\.Begin\(([^)]*)\)/g)].map((m) => m[1]);
  check(`every lookup says which window it is asking about (${calls.length})`,
        calls.length >= 3 && calls.every((a) => a.split(',').length === 3), calls.join(' | '));
}

console.log('\nthe control is asked about at the moment of the click:');
{
  const fs3 = require('node:fs');
  const path3 = require('node:path');
  const rec = fs3.readFileSync(
    path3.join(__dirname, '..', 'capture', 'Recorder.cs'), 'utf8');

  // Asked after the screenshot, a click that opens a dialog is named after
  // whatever the dialog put under the pointer. The step then names a control
  // the user never touched, which is worse than naming nothing: the picture
  // and the words disagree, and only the words are wrong.
  const begins = [...rec.matchAll(/UiaResolver\.Begin\(/g)].length;
  const ends = [...rec.matchAll(/UiaResolver\.End\(/g)].length;
  check(`every step path starts a lookup (${begins})`, begins >= 2);
  check('and collects exactly as many as it starts', begins === ends);

  // Order, within each path that uses it.
  const paths = [...rec.matchAll(/UiaResolver\.Begin/g)].map((m) => m.index);
  for (const at of paths) {
    const body = rec.slice(at, rec.indexOf('UiaResolver.End', at) + 20);
    check('the screenshot is taken between asking and collecting',
          /CaptureOrReuse|ScreenCapture\.CaptureTo/.test(body),
          'no capture between Begin and End - the query is not overlapping anything');
  }

  check('nothing in the engine still resolves inline',
        !/UiaResolver\.Resolve\(/.test(rec));
}

console.log('\na crop cuts everything the marker depends on:');
{
  // The unit tests cover crop.js on its own and pass whether or not the
  // handler calls it - which is exactly how the dragged marker came to drift
  // through a crop with a full green suite. This checks the wiring.
  const at = main.indexOf("ipcMain.handle('step:crop'");
  // To the end of the handler, not to the first closing brace inside it -
  // which stopped at the end of the pushUndo call and missed the write.
  const body = main.slice(at, main.indexOf('\n});', at) + 3);

  check('the crop handler was found', at > 0 && body.length > 200);
  check('it cuts the frame with the picture', /frameAfter\(/.test(body));
  // A recorded marker follows the frame; a dragged one is a percentage of the
  // picture and has to be moved itself.
  check('and moves a dragged marker with it', /markerAtAfter\(/.test(body),
        'crop.js can move it, but step:crop never asks');
  check('writing the result back', /markerAt: nextMarker/.test(body),
        'the new position is computed and then discarded');
}

console.log('\nnothing typed, chosen or reported is lost:');
{
  // The audit's first tier, each pinned so it cannot quietly come back.
  check('typed wording is captured with the step it was typed into',
        /pendingText = \{ id: selectedId, text: el\.text\.value \}/.test(renderer));
  check('and saved before another step is given the box',
        /if \(pendingText && pendingText\.id !== id\) flushText\(\);/.test(renderer));
  check('a field change goes into the undo history', /history\.pushPatch\(id, was\)/.test(main));
  check('a reorder records the move that puts it back',
        /pushUndo\(\{ type: 'reorder', from: to, to: from \}\)/.test(main));
  check('adding a note records its removal',
        /session\.addNote\(text, afterId\);\s*\n\s*if \(r && r\.step\) pushUndo\(\{ type: 'removeSteps'/.test(main));
  check('as does adding a heading',
        /session\.addSection\(text, afterId\);\s*\n\s*if \(r && r\.step\) pushUndo\(\{ type: 'removeSteps'/.test(main));
  check('the new recording dialog starts on the Capture choice',
        /el\.suScope\.value = available \? chosen : '';/.test(renderer));
  check('the Saved bar does not hide the notices',
        !/el\.notice\.hidden = true;\s*\n\s*el\.finished\.hidden = false;/.test(renderer));
  check('main tells the window whether a recording was live when the engine went',
        /send\('sidecar:exit', \{ code, duringRecording/.test(main));
}

console.log('\nheadings are not counted as steps:');
{
  // The count a reader is given has to be the number of things to do. Before
  // headings existed the test for "is this a step" was action !== 'note', and
  // any survivor of that counts a heading.
  const survivors = sourceFiles()
    .map(([name, src]) => [name, [...src.matchAll(/action !== 'note'/g)].length])
    .filter(([, n]) => n > 0);

  check(`every module was looked at (${sourceFiles().length})`,
        sourceFiles().length >= 15);
  check('nothing still asks "is it not a note"', survivors.length === 0,
        survivors.map(([f, n]) => `${f}: ${n}`).join(', '));
}

console.log('\nthe step list uses the wording rules, not the raw fields:');
{
  // rowTitle and actionWord are tested on their own in appname_test. What
  // nothing else can see is whether the list still calls them: put s.text and
  // s.action back in renderList and every unit test stays green while the list
  // repeats its window on every row and prints leftClick under it.
  const at = renderer.indexOf('function renderList()');
  const body = renderer.slice(at, renderer.indexOf('\n}\n', at));
  check('a row title comes from rowTitle', /BsrAppName\.rowTitle\(s, recordedBefore\(i\)\)/.test(body));
  check('the action is put into words', /BsrAppName\.actionWord\(s\.action\)/.test(body));
  check('and the program is named only where it changes', /appChangedAt\(i\) \?/.test(body));
  check('the step before is found with isStep, the one definition of a step',
        /function recordedBefore[\s\S]{0,200}BsrSections\.isStep\(p\)/.test(renderer));
  // The line over the picture said the same things the list used to: the
  // engine's word for the action, and a row index where a step number belongs.
  check('the detail line puts the action into words',
        /BsrAppName\.actionWord\(step\.action\)/.test(renderer));
  check('and numbers the step the way the list does',
        /filter\(\(s\) => BsrSections\.isStep\(s\)\)\.length;\s*\n\s*el\.meta\.textContent/.test(renderer));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
