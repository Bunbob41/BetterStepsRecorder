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

console.log('\nthe engine is told the chord it will actually build:');
{
  // A hotkey the engine does not recognise is a hotkey it does not suppress,
  // and the last step of the recording is the user pressing stop. The two
  // sides name keys for different readers, so every key the rebinding dialog
  // can produce has to be checked against the engine's own spelling.
  const fs = require('node:fs');
  const path = require('node:path');
  const hook = fs.readFileSync(
    path.join(__dirname, '..', 'capture', 'KeyboardHook.cs'), 'utf8');

  // The engine's map, read from the engine rather than copied here - a copy
  // would go on agreeing with itself after the engine changed.
  const named = new Set(
    [...hook.matchAll(/0x[0-9A-F]{2} => "([^"]+)"/g)].map((m) => m[1].toUpperCase()));
  check(`the engine's key names were found (${named.size})`, named.size >= 12);
  // Function keys are built, not listed.
  for (let i = 1; i <= 24; i++) named.add(`F${i}`);
  // Letters and digits come back from the keyboard layout as themselves.
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') named.add(c);
  // Space falls through to the printable character, which is a space.
  named.add(' ');

  // Every ending the accelerator builder can produce.
  const endings = [
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
    'A', 'Z', '0', '9', 'Space',
    'Up', 'Down', 'Left', 'Right',
    'Home', 'End', 'PageUp', 'PageDown',
    'Insert', 'Delete', 'Backspace', 'Tab', 'Enter',
  ];

  let bad = [];
  for (const key of endings) {
    const chord = s.toEngineChord(`Control+Shift+${key}`);
    const ending = chord.replace(/^Ctrl\+Shift\+/, '');
    if (!named.has(ending)) bad.push(`${key} -> ${JSON.stringify(ending)}`);
  }
  check('every key a shortcut can end in is one the engine names',
        bad.length === 0, bad.join(', '));

  // The three that were wrong, named so a regression says which.
  check('Page Up is spelt the engine\'s way',
        s.toEngineChord('Control+Shift+PageUp') === 'Ctrl+Shift+PAGE UP');
  check('so is Page Down',
        s.toEngineChord('Control+Shift+PageDown') === 'Ctrl+Shift+PAGE DOWN');
  check('and Space is the character, because the engine has no name for it',
        s.toEngineChord('Control+Alt+Space') === 'Ctrl+Alt+ ');
  check('an arrow needs no translation',
        s.toEngineChord('Control+Shift+Up') === 'Ctrl+Shift+UP');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
