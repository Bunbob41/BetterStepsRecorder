/**
 * Find and replace across a recording.
 *
 * The properties that matter: a query is a literal string and not a pattern,
 * whole-word means word, notes and headings are included because a reader sees
 * them, and a replacement that changes nothing is reported as nothing.
 */
const f = require('../ui/src/renderer/find');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const step = (id, text) => ({ id, action: 'leftClick', text });
const note = (id, text) => ({ id, action: 'note', text });
const head = (id, text) => ({ id, action: 'section', text });

console.log('a query is what was typed, not a pattern:');
{
  // Everything a person searches for in a procedure is made of regex syntax.
  // Without escaping, "(" throws and "." matches every character there is.
  check('a full stop matches a full stop, not everything',
        f.countIn('a.b acb', 'a.b') === 1);
  check('brackets are searchable at all',
        f.countIn('Open (draft) now', '(draft)') === 1);
  check('a backslash path is searchable',
        f.countIn('C:\\Users\\M open', 'C:\\Users') === 1);
  check('a plus is not a repeat',
        f.countIn('a+b aab', 'a+b') === 1);
  check('and a star is not a wildcard', f.countIn('a*b axb', 'a*b') === 1);
}

console.log('\ncase:');
{
  check('ignored by default', f.countIn('Save the SAVE save', 'save') === 3);
  check('respected when asked',
        f.countIn('Save the SAVE save', 'save', { caseSensitive: true }) === 1);
}

console.log('\nwhole words:');
{
  check('a substring is found by default',
        f.countIn('Save the Saved file', 'Save') === 2);
  check('and not when whole words are asked for',
        f.countIn('Save the Saved file', 'Save', { wholeWord: true }) === 1);

  // \b anchors to a word character, so a query that begins with punctuation
  // matches nothing at all with it - which is worse than being too loose.
  check('a query starting with punctuation still works',
        f.countIn('the (draft) copy', '(draft)', { wholeWord: true }) === 1);
  check('a hyphenated phrase is one word to a reader',
        f.countIn('sign-off needed', 'sign-off', { wholeWord: true }) === 1);
}

console.log('\nwhat gets searched:');
{
  const steps = [
    step('a', 'Click the Save button'),
    note('n', 'Wait for Save to finish'),
    head('h', 'Save the file'),
    step('b', 'Click Cancel'),
    { id: 'x', action: 'leftClick' },              // no text at all
  ];
  const hits = f.matches(steps, 'Save');

  check('recorded steps', hits.some((h) => h.id === 'a'));
  // A rename that skipped these would leave the guide contradicting itself.
  check('written notes too', hits.some((h) => h.id === 'n'));
  check('and headings', hits.some((h) => h.id === 'h'));
  check('rows without the word are left out', !hits.some((h) => h.id === 'b'));
  check('a row with no text at all does not throw',
        !hits.some((h) => h.id === 'x'));
  check('each says where it is', hits[0].index === 0);
  check('and how many times', f.matches([step('c', 'Save Save')], 'Save')[0].count === 2);

  check('an empty query finds nothing rather than everything',
        f.matches(steps, '').length === 0);
  check('and neither does a missing list', f.matches(undefined, 'Save').length === 0);
}

console.log('\nreplacing:');
{
  check('every occurrence in the string',
        f.replaced('Save then Save', 'Save', 'Store') === 'Store then Store');
  check('case-insensitively by default',
        f.replaced('save SAVE', 'save', 'store') === 'store store');

  // $& and friends are regex replacement syntax; somebody replacing a price
  // with "$5" means the two characters they typed.
  check('a replacement is literal, not a template',
        f.replaced('costs X', 'X', '$5') === 'costs $5');
  check('and so is an ampersand pattern',
        f.replaced('a', 'a', '$&b') === '$&b');

  check('replacing with nothing removes it',
        f.replaced('the Save button', 'Save ', '') === 'the button');
  check('missing text does not throw', f.replaced(undefined, 'a', 'b') === '');
}

console.log('\nwhat a replace-all would do, before it does it:');
{
  const steps = [
    step('a', 'Click the Save button'),
    step('b', 'Click Cancel'),
    note('n', 'Save first'),
  ];
  const changes = f.plan(steps, 'Save', 'Store');

  check('one entry per row that changes', changes.length === 2);
  check('carrying the new text', changes[0].text === 'Click the Store button');
  check('and the old, so it can be undone', changes[0].was === 'Click the Save button');
  check('rows that do not change are absent', !changes.some((c) => c.id === 'b'));

  // Filling the undo history with a no-op is worse than refusing.
  check('replacing a word with itself is not a change',
        f.plan(steps, 'Save', 'Save').length === 0);
  check('and neither is an empty query', f.plan(steps, '', 'x').length === 0);

  // But a case-only change IS a change, and must not be discarded with them.
  check('a case-only change still counts',
        f.plan([step('c', 'save it')], 'save', 'Save').length === 1);
}

console.log('\nwhat the author is told:');
{
  const steps = [step('a', 'Save Save'), step('b', 'Save')];
  check('occurrences and rows, not just rows',
        f.describe(f.plan(steps, 'Save', 'Store')) === 'Replaced 3 occurrences in 2 steps.');
  check('singular reads properly',
        f.describe(f.plan([step('a', 'Save')], 'Save', 'Store'))
        === 'Replaced 1 occurrence in 1 step.');
  check('and nothing is said plainly', f.describe([]) === 'Nothing to replace.');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
