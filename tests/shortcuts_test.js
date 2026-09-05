/**
 * Shortcut conversion. The property that matters most: whatever is registered
 * globally must produce the exact chord label the capture engine suppresses,
 * or pressing stop becomes the last step of the recording.
 */
const s = require('../ui/src/main/shortcuts');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

console.log('accelerator -> engine chord:');
check('the default pause chord matches the engine format',
      s.toEngineChord('Control+Shift+F9') === 'Ctrl+Shift+F9');
check('the default stop chord matches',
      s.toEngineChord('Control+Shift+F10') === 'Ctrl+Shift+F10');
check('modifier order is normalised, not echoed',
      s.toEngineChord('Shift+Control+F7') === 'Ctrl+Shift+F7');
check('alt and win are translated',
      s.toEngineChord('Alt+Super+R') === 'Alt+Win+R');
check('letters are upper-cased like the engine does',
      s.toEngineChord('Control+r') === 'Ctrl+R');

console.log('\nwhat the user reads:');
check('keycaps are split and shortened',
      s.toDisplay('Control+Shift+F9').join() === 'Ctrl,Shift,F9');

console.log('\nbuilding one from a key press:');
const ev = (o) => ({ key: '', code: '', ctrlKey: false, altKey: false,
                     shiftKey: false, metaKey: false, ...o });
check('ctrl+shift+F8 is accepted',
      s.fromEvent(ev({ key: 'F8', ctrlKey: true, shiftKey: true })) === 'Control+Shift+F8');
check('a function key alone is allowed',
      s.fromEvent(ev({ key: 'F12' })) === 'F12');
check('a bare letter is refused, it would hijack typing everywhere',
      s.fromEvent(ev({ key: 'r' })) === null);
check('a modifier on its own is not a shortcut',
      s.fromEvent(ev({ key: 'Shift', shiftKey: true })) === null);
check('ctrl+letter is fine', s.fromEvent(ev({ key: 'r', ctrlKey: true })) === 'Control+R');
check('modifiers come out in a stable order',
      s.fromEvent(ev({ key: 'P', ctrlKey: true, altKey: true, shiftKey: true }))
        === 'Control+Alt+Shift+P');

console.log('\nvalidation:');
check('a bare letter is invalid', !s.isValid('R'));
check('a function key is valid', s.isValid('F9'));
check('an empty value is invalid', !s.isValid(''));
check('junk is invalid', !s.isValid('Nonsense+Q'));

console.log('\nresolving what is configured:');
check('blank settings fall back to the defaults',
      s.resolve({}).pause === s.DEFAULTS.pause);
check('an invalid stored value falls back rather than breaking',
      s.resolve({ hotkeyPause: 'R' }).pause === s.DEFAULTS.pause);
check('a configured value is used',
      s.resolve({ hotkeyStop: 'Control+Alt+X' }).stop === 'Control+Alt+X');
check('the engine is told about the configured one, not the default',
      s.engineChords({ hotkeyStop: 'Control+Alt+X' })[1] === 'Ctrl+Alt+X');
check('both chords are passed to the engine', s.engineChords({}).length === 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
