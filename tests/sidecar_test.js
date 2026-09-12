/**
 * The capture engine's process, as the app sees it.
 *
 * Two things that went wrong while recording full-screen games. Every error the
 * engine reported ended the recording in the window - including one about a
 * single slow screen copy, while the engine carried on recording underneath.
 * And quitting stopped the engine twice, which wrote to a stream that was
 * already closed and left "write after end" as the only line in the log, where
 * it read like a crash.
 */
const { Sidecar, isFatal } = require('../ui/src/main/sidecar');

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS ' + n); return; }
  fail++;
  console.log('  FAIL ' + n + (extra ? `\n        ${extra}` : ''));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('which engine errors end a recording:');
  check('the mouse hook failing to install does - there is no recording', isFatal('HOOK_FAILED'));
  check('the engine failing to start does', isFatal('SPAWN_FAILED'));
  for (const code of ['STEP_FAILED', 'HOOK_CALLBACK', 'PRESS_CAPTURE_FAILED', 'PRESS_COPY_SLOW',
                      'VERIFY_FAILED', 'COMMAND_FAILED', 'BAD_COMMAND', 'BAD_JSON']) {
    check(`${code} does not - the engine is still recording`, !isFatal(code));
  }
  check('nor does a code nobody has invented yet', !isFatal('SOMETHING_NEW'));

  console.log('\nstopping the engine twice, which quitting does:');
  {
    // A stand-in engine: node reading its stdin until it closes, which is also
    // what the real engine does - EOF on stdin is its guard against being left
    // behind holding a global mouse hook.
    const uncaught = [];
    const onUncaught = (e) => uncaught.push(e);
    process.on('uncaughtException', onUncaught);

    const engine = new Sidecar();
    const exited = new Promise((resolve) => engine.once('exit', resolve));
    engine.on('log', () => {});      // whatever the stand-in says on stderr
    engine.start(process.execPath);
    await sleep(150);
    check('the stand-in engine is running', engine.running);

    let threw = null;
    try {
      engine.stop();     // window-all-closed
      engine.stop();     // before-quit
    } catch (e) { threw = e; }

    // "write after end" is raised on the stream, a tick later, not by the call.
    await sleep(300);
    check('the second stop does not throw', threw === null, threw && threw.message);
    check('and does not raise "write after end" a moment later', uncaught.length === 0,
          uncaught.map((e) => e.message).join('; '));
    check('a command sent after stopping says it was not sent',
          engine.send({ type: 'pong' }) === false);

    await Promise.race([exited, sleep(5000)]);
    process.off('uncaughtException', onUncaught);
    check('and the engine goes away once its stdin is closed', !engine.running);
  }

  console.log('\nan engine on its way out is not a usable engine:');
  {
    // Stop closes stdin and the process object lives on until its exit event.
    // For that window the engine read as "running", so a recording started in
    // it wrote to a closed pipe, the write failed, and the recording was
    // refused with no reason given. Stop and then Continue is the most natural
    // sequence there is, which made it easy to hit.
    const engine = new Sidecar();
    const exited = new Promise((resolve) => engine.once('exit', resolve));
    engine.on('log', () => {});
    engine.start(process.execPath);
    await sleep(150);
    check('it starts out running and not stopping',
          engine.running && !engine.stopping);

    engine.stop();
    check('once stopped it is no longer running', !engine.running);
    check('and says it is on its way out', engine.stopping);
    check('and a start sent into that window is refused rather than lost',
          engine.startSession('C:/nowhere', [], {}) === false);

    await Promise.race([exited, sleep(5000)]);
    check('once it has gone it is neither running nor stopping',
          !engine.running && !engine.stopping);

    // And the whole point: a fresh one can then be started.
    const again = new Sidecar();
    again.on('log', () => {});
    again.start(process.execPath);
    await sleep(150);
    check('so a fresh engine can take its place', again.running && !again.stopping);
    again.stop();
    await Promise.race([new Promise((r) => again.once('exit', r)), sleep(5000)]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
