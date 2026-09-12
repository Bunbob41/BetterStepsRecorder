/**
 * What a recording is called after.
 *
 * Two things went wrong at once here: the label was the FIRST step's
 * application, which is nearly always the taskbar, and it was the filename,
 * which is nobody's idea of an answer. A recording of Gemini in Chrome listed
 * as "explorer.exe".
 */
const a = require('../ui/src/renderer/appname');

let pass = 0, fail = 0;
const check = (n, ok) => { ok ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const step = (process, product) =>
  ({ id: 's' + Math.random(), action: 'leftClick', window: { process, product } });

console.log('what Windows calls it wins:');
{
  check('the product name is used when there is one',
        a.friendly('chrome.exe', 'Google Chrome') === 'Google Chrome');
  check('even when the filename is one we know',
        a.friendly('explorer.exe', 'Windows Explorer') === 'Windows Explorer');
  check('blank product names do not win',
        a.friendly('chrome.exe', '   ') === 'Chrome');
  check('and neither does a missing one', a.friendly('chrome.exe') === 'Chrome');
}

console.log('\nand without one, the filename is made presentable:');
{
  check('a lowercase name is capitalised', a.tidy('chrome.exe') === 'Chrome');
  check('a shouted one is calmed down', a.tidy('EXCEL.EXE') === 'Excel');
  // Re-casing something whose author capitalised it makes it worse.
  check('a name with its own casing is left alone',
        a.tidy('WindowsTerminal.exe') === 'WindowsTerminal');
  check('and so is one like iTunes', a.tidy('iTunes.exe') === 'iTunes');
  check('nothing in, nothing out', a.tidy('') === '');
}

console.log('\nWindows executables nobody could guess:');
{
  check('explorer is File Explorer', a.friendly('explorer.exe') === 'File Explorer');
  check('whatever its case', a.friendly('EXPLORER.EXE') === 'File Explorer');
  check('taskmgr is Task Manager', a.friendly('Taskmgr.exe') === 'Task Manager');
  check('and an unknown one just gets tidied',
        a.friendly('MyOddTool.exe') === 'MyOddTool');
}

console.log('\nthe application a recording is ABOUT:');
{
  // The actual case from the screenshot: one taskbar click, then everything
  // else in the browser.
  const recording = [
    step('explorer.exe'),
    step('chrome.exe', 'Google Chrome'),
    step('chrome.exe', 'Google Chrome'),
    step('chrome.exe', 'Google Chrome'),
  ];

  check('is the one it spent its time in, not the one it started in',
        a.dominant(recording).process === 'chrome.exe');
  check('and it is named properly', a.forRecording(recording) === 'Google Chrome');

  // The old behaviour, stated as the thing it must not do.
  check('the first step no longer decides it',
        a.forRecording(recording) !== 'File Explorer');
}

console.log('\nawkward recordings:');
{
  check('one with no steps has no application', a.forRecording([]) === '');
  check('and neither does one never passed', a.forRecording(undefined) === '');
  check('steps with no window are skipped',
        a.forRecording([{ id: 'x', action: 'note' }, step('chrome.exe')]) === 'Chrome');

  // A product name recorded on one step must name the whole recording, even
  // when older steps for the same application do not carry it.
  const mixed = [step('chrome.exe'), step('chrome.exe', 'Google Chrome')];
  check('a product name found anywhere is used',
        a.forRecording(mixed) === 'Google Chrome');

  // A genuine tie: whichever it settles on, it must be one of them and must
  // not be empty.
  const tied = [step('a.exe'), step('b.exe')];
  check('a tie still produces a name', ['A', 'B'].includes(a.forRecording(tied)));
}

console.log('\nwhat to call a recording nobody named:');
{
  const hypack = (n) => Array.from({ length: n }, (_, i) => ({
    id: `s${i}`, action: 'leftClick',
    window: { process: 'Hypack64.exe', product: 'HYPACK Shell' },
  }));

  // The application, not the size: the library card prints the count beside
  // the name, and a guide titled with its own length reads like a filename.
  check('it is named after what it recorded, and nothing else',
        a.label(hypack(37), 37) === 'HYPACK Shell');
  check('the count stays out of the name however many steps',
        a.label(hypack(1), 1) === 'HYPACK Shell');
  // The product name is Windows' own answer; the filename is the fallback.
  check('an application that will not say its name is named by its file',
        a.label([{ id: 'a', window: { process: 'hypack64.exe', product: '' } }], 4)
        === 'Hypack64');
  // Nothing to say beats saying nothing usefully: the caller keeps its own name.
  check('a recording with no window in it is not named', a.label([], 0) === '');
  check('nor is one with windows but no steps counted',
        a.label(hypack(3), 0) === '');
}

console.log('\na name its own program shipped damaged is cleaned for display:');
{
  // Read straight off C:\HYPACK 2025\x64\SBMAX64.exe: its version resource
  // carries U+00EF U+00BF U+00BD where a trademark sign should be.
  check('the damaged characters are removed',
        a.friendly('SBMAX64.exe', 'HYPACK\u00ef\u00bf\u00bd 64 Bit Single Beam Editor')
        === 'HYPACK 64 Bit Single Beam Editor');
  check('as is a bare replacement character', a.friendly('x.exe', 'Tool\ufffd Pro') === 'Tool Pro');
  // Removing damage must not remove the real thing.
  check('a genuine trademark sign is left alone',
        a.friendly('x.exe', 'HYPACK\u00ae') === 'HYPACK\u00ae');
  check('a clean name is left exactly as it was',
        a.friendly('chrome.exe', 'Google Chrome') === 'Google Chrome');
  check('a name that was nothing but damage falls back to the file',
        a.friendly('sbmax64.exe', '\u00ef\u00bf\u00bd') === 'Sbmax64');
  check('and the recording name comes out clean too',
        a.label([{ window: { process: 'SBMAX64.exe',
                             product: 'HYPACK\u00ef\u00bf\u00bd 64 Bit Single Beam Editor' } }], 1)
        === 'HYPACK 64 Bit Single Beam Editor');
}

console.log('\nwhat an action is called on screen:');
{
  check('a left click is a Click', a.actionWord('leftClick') === 'Click');
  check('a right click', a.actionWord('rightClick') === 'Right-click');
  check('a double click', a.actionWord('doubleClick') === 'Double-click');
  check('a drag', a.actionWord('drag') === 'Drag');
  check('keys', a.actionWord('keyPress') === 'Keyboard');
  // The engine is newer than any list here.
  check('an action this version has not heard of still reads as words',
        a.actionWord('middleClick') === 'Middle click');
  check('and nothing is nothing', a.actionWord('') === '');
}

console.log('\na row does not repeat the window the row above named:');
{
  const w = (title) => ({ title, process: 'meridian.exe' });
  const first = { text: 'Clicked the "Calibration" tab in "Meridian Sensor Setup"',
                  window: w('Meridian Sensor Setup') };
  const second = { text: 'Clicked the "Sensor type" dropdown in "Meridian Sensor Setup"',
                   window: w('Meridian Sensor Setup') };
  check('the first row keeps its window', a.rowTitle(first, null) === first.text);
  check('the next row in the same window drops it',
        a.rowTitle(second, first) === 'Clicked the "Sensor type" dropdown');
  const elsewhere = { text: 'Clicked the "OK" button in "Save As"', window: w('Save As') };
  check('a row in a different window keeps it', a.rowTitle(elsewhere, second) === elsewhere.text);
  // "Double-clicked" alone says nothing; the window is all it has.
  const bare = { text: 'Double-clicked in "Meridian Sensor Setup"', window: w('Meridian Sensor Setup') };
  check('a row that would be left saying nothing keeps its window',
        a.rowTitle(bare, first) === bare.text);
  // Somebody's own wording is theirs.
  check('wording a person wrote is never shortened',
        a.rowTitle({ ...second, textEdited: true }, first) === second.text);
  // A window title that happens to appear mid-sentence is not the suffix.
  const mid = { text: 'Clicked "Meridian Sensor Setup" in "Launcher"', window: w('Launcher') };
  check('only the trailing window is ever taken off',
        a.rowTitle(mid, { window: w('Launcher') }) === 'Clicked "Meridian Sensor Setup"');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
