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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
