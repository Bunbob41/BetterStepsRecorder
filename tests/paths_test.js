/**
 * Keeping a recording's file references inside the recording.
 *
 * A recording is a folder meant to be handed to somebody, so `session.json` is
 * not our data - it is a file from outside, and every path in it is a claim
 * rather than a fact. These are the checks that stop a crafted one reaching
 * files that are none of its business.
 */
const path = require('node:path');
const { insideDir, safeJoin, safeReference } = require('../ui/src/main/paths');

let pass = 0, fail = 0;
const check = (n, ok) => { ok ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const DIR = path.resolve('C:/Recordings/session-1');

console.log('what counts as inside a recording:');
{
  check('a file in it', insideDir(DIR, path.join(DIR, 'steps', '0001.png')));
  check('the folder itself', insideDir(DIR, DIR));
  check('a file above it is not', !insideDir(DIR, path.resolve('C:/Recordings/x.png')));
  check('and neither is one far outside',
        !insideDir(DIR, path.resolve('C:/Windows/win.ini')));

  // The reason this is not startsWith: session-10 begins with session-1.
  check('a SIBLING recording is not inside this one',
        !insideDir(DIR, path.resolve('C:/Recordings/session-10/private.png')));

  check('nothing at all is not inside', !insideDir(DIR, ''));
  check('and neither is a missing directory', !insideDir('', 'x'));
}

console.log('\njoining a reference from a recording:');
{
  check('an ordinary one resolves',
        safeJoin(DIR, 'steps/0001.png') === path.join(DIR, 'steps', '0001.png'));
  check('a nested one does too',
        safeJoin(DIR, 'steps/sub/a.png') === path.join(DIR, 'steps', 'sub', 'a.png'));

  // The one that matters. Blurring a step writes to whatever this returns, so
  // a crafted recording could otherwise replace any file the user can write.
  check('one that climbs out is refused',
        safeJoin(DIR, '../../Windows/win.ini') === null);
  check('however deeply it climbs',
        safeJoin(DIR, 'steps/../../../secrets.txt') === null);
  check('an absolute path is refused outright',
        safeJoin(DIR, 'C:/Windows/win.ini') === null);
  check('and a UNC path is too', safeJoin(DIR, '//server/share/x') === null);

  check('nothing is refused rather than resolving to the folder',
        safeJoin(DIR, '') === null);
  check('and so is a value that is not a string', safeJoin(DIR, 42) === null);
}

console.log('\njudging a reference before it is joined to anything:');
{
  check('a plain one is fine', safeReference('steps/0001.png'));
  check('a climbing one is not', !safeReference('../x.png'));
  check('a deeper climb is not either', !safeReference('a/../../x.png'));
  check('an absolute one is not', !safeReference('C:/x.png'));
  check('an empty one is not', !safeReference(''));
  check('and neither is a missing one', !safeReference(undefined));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
