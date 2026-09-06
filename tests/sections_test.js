/**
 * Headings, and where the tool offers to put them.
 *
 * The properties that matter: step numbering runs straight through the
 * sections rather than restarting, a heading left with nothing under it never
 * reaches the reader, and a suggestion stops being made once it is answered.
 */
const s = require('../ui/src/renderer/sections');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const step = (app, extra = {}) =>
  ({ id: `s${Math.random()}`, action: 'leftClick', window: { process: app }, ...extra });
const head = (text) => ({ id: `h${Math.random()}`, action: 'section', text });
const note = (text) => ({ id: `n${Math.random()}`, action: 'note', text });

console.log('what counts as a step:');
{
  check('a click does', s.isStep(step('chrome.exe')));
  check('a heading does not', !s.isStep(head('Preparation')));
  check('and neither does a note', !s.isStep(note('Wait for the batch')));

  // The number a reader is given has to be the number of things to do.
  check('the count ignores both',
        s.countSteps([step('a'), head('P'), note('n'), step('a')]) === 2);
  check('an empty recording counts nothing', s.countSteps([]) === 0);
  check('and so does one never passed', s.countSteps(undefined) === 0);
}

console.log('\nwhere a section is offered:');
{
  const rows = [step('chrome.exe'), step('chrome.exe'),
                step('excel.exe'), step('excel.exe')];
  const at = s.suggestions(rows);

  check('at the point the application changed', at.length === 1 && at[0].index === 2);
  check('naming the application it changed to', at[0].app === 'excel.exe');
  check('and identifying the step, not just the slot', at[0].id === rows[2].id);

  // "Nothing, then Chrome" is not a change of application, and a heading above
  // step one is the document's title.
  check('never before the first step',
        !s.suggestions([step('chrome.exe'), step('chrome.exe')]).length);

  check('one recording in one application is not offered anything',
        s.suggestions([step('a'), step('a'), step('a')]).length === 0);

  check('every change is offered',
        s.suggestions([step('a'), step('b'), step('c')]).length === 2);
}

console.log('\nan offer that has been answered is not made again:');
{
  // Accepting has to silence it, or the suggestion sits under the heading it
  // just produced and asks for it a second time.
  check('accepting silences it',
        s.suggestions([step('a'), head('Phase two'), step('b')]).length === 0);

  check('declining silences it',
        s.suggestions([step('a'), step('b', { noSection: true })]).length === 0);

  // But only that one: a heading in one place must not suppress a boundary
  // further down the recording.
  const later = s.suggestions([step('a'), head('Two'), step('b'), step('c')]);
  check('and only that one', later.length === 1 && later[0].app === 'c');
}

console.log('\na step with no application recorded:');
{
  // The engine cannot always name the process. A blank is not a change.
  check('does not invent a boundary',
        s.suggestions([step('a'), step(''), step('a')]).length === 0);
  check('and does not hide the real one that follows',
        s.suggestions([step('a'), step(''), step('b')]).length === 1);
}

console.log('\na heading with nothing under it never reaches the reader:');
{
  check('a trailing one is dropped',
        s.withoutEmpty([step('a'), head('Empty')]).length === 1);

  check('two in a row keep only the one that has content',
        s.withoutEmpty([head('A'), head('B'), step('a')])
          .map((r) => r.text || 'step').join() === 'B,step');

  check('one with a step under it stays',
        s.withoutEmpty([head('A'), step('a')]).length === 2);

  // A heading over an authored note is a real section: the note is its content.
  check('one with only a note under it stays',
        s.withoutEmpty([head('Prerequisites'), note('Get VPN access')]).length === 2);

  // The point of it: excluding every step of a phase must take the phase with
  // them, not leave a promise the document does not keep.
  const exported = [head('Setup'), head('Doing it'), step('a')];
  check('so excluding a phase removes its heading',
        !s.withoutEmpty(exported).some((r) => r.text === 'Setup'));

  check('a recording with no headings is untouched',
        s.withoutEmpty([step('a'), note('n')]).length === 2);
  check('and an empty one does not throw', s.withoutEmpty([]).length === 0);
}

console.log('\na heading with no name is not a heading:');
{
  // Accepting a suggested boundary inserts an unnamed heading, because the
  // tool knows where a phase probably starts and not what it is called. Until
  // it is named there is nothing to print, and an empty one renders as a rule
  // with a gap where the name should be - a defect, not a section.
  check('an unnamed one is dropped', s.withoutEmpty([head(''), step('a')]).length === 1);
  check('and so is one that is only whitespace',
        s.withoutEmpty([head('   '), step('a')]).length === 1);

  // But it must not take the steps under it with it, and it must not make the
  // heading above it look empty either.
  const mixed = s.withoutEmpty([head('Setup'), head(''), step('a'), step('b')]);
  check('the steps under it survive', mixed.filter(s.isStep).length === 2);
  check('and the named heading above it survives',
        mixed.some((r) => r.text === 'Setup'));

  // Two unnamed ones in a row must not fool the "is there content below" walk.
  const two = s.withoutEmpty([head('Setup'), head(''), head(''), step('a')]);
  check('several unnamed in a row are all dropped', two.length === 2);
  check('and the named one still stands', two[0].text === 'Setup');

  // A named heading whose only content is an unnamed heading really is empty.
  check('a named heading followed only by an unnamed one goes too',
        s.withoutEmpty([head('Setup'), head('')]).length === 0);
}

console.log('\nwhich heading a step falls under:');
{
  const rows = [step('a'), head('Two'), step('b'), note('n'), head('Three'), step('c')];
  const under = s.sectionOf(rows);

  check('nothing before the first heading', under[0] === '');
  check('the heading names itself', under[1] === 'Two');
  check('a step below it is in it', under[2] === 'Two');
  check('and so is a note', under[3] === 'Two');
  check('until the next heading', under[5] === 'Three');
  check('one entry per row', under.length === rows.length);
}

console.log('\nwhether a guide has phases at all:');
{
  check('it does', s.hasSections([step('a'), head('P')]));
  check('it does not', !s.hasSections([step('a'), note('n')]));
  check('and neither does nothing', !s.hasSections([]));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
