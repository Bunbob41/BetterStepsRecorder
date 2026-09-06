/**
 * Finding the recordings on disk. The property that matters: a folder is a
 * recording because of what is inside it, not what it is called. Requiring the
 * `session-` prefix made a renamed folder vanish from the application while
 * sitting untouched on disk - 404MB of it.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const library = require('../ui/src/main/library');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-lib-'));

function makeSession(folder, { name, steps = [], savedAt = null } = {}) {
  const dir = path.join(root, folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'session.json'),
    JSON.stringify({ name, steps, savedAt }));
  return dir;
}

const win = (p) => ({ title: 'w', process: p, rect: { x: 0, y: 0, w: 1, h: 1 } });

makeSession('session-2026-09-05T21-13-14-778Z', {
  name: '9/5/2026, 2:13:14 PM', savedAt: '2026-09-05T21:20:00.000Z',
  steps: [{ action: 'leftClick', window: win('explorer.exe') },
          { action: 'note', text: 'aside' }],
});
makeSession('RL', {
  name: '9/5/2026, 1:19:13 PM', savedAt: '2026-09-05T21:24:00.000Z',
  steps: [{ action: 'leftClick', window: win('RocketLeague.exe') },
          { action: 'leftClick', window: win('RocketLeague.exe') }],
});

console.log('a folder the user renamed:');
{
  const found = library.list(root);
  const rl = found.find((e) => path.basename(e.dir) === 'RL');
  check('is still a recording', Boolean(rl));
  check('and keeps the name it was given inside the app',
        rl && rl.name === '9/5/2026, 1:19:13 PM');
  check('with its steps counted', rl && rl.steps === 2);
  check('and the application it was about', rl && rl.app === 'RocketLeague.exe');
}

console.log('\nthe rest of the listing:');
{
  const found = library.list(root);
  check('both recordings are listed', found.length === 2);
  check('newest first', found[0].savedAt > found[1].savedAt);
  check('notes are not counted as steps',
        found.find((e) => e.app === 'explorer.exe').steps === 1);
}

console.log('\nwhat is not a recording:');
{
  fs.mkdirSync(path.join(root, 'holiday photos'), { recursive: true });
  fs.writeFileSync(path.join(root, 'loose-file.txt'), 'x');
  fs.mkdirSync(path.join(root, 'session-broken'), { recursive: true });
  fs.writeFileSync(path.join(root, 'session-broken', 'session.json'), '{ not json');

  const found = library.list(root);
  check('a folder with no session.json is ignored', found.length === 2);
  check('and one with an unreadable session.json is skipped, not fatal',
        !found.some((e) => e.dir.endsWith('session-broken')));
}

console.log('\nedge cases:');
{
  check('a missing folder is empty, not an error',
        library.list(path.join(root, 'nope')).length === 0);
  check('no folder at all is empty', library.list('').length === 0);

  makeSession('unnamed', { name: '', steps: [] });
  const found = library.list(root);
  const u = found.find((e) => path.basename(e.dir) === 'unnamed');
  check('a recording with no name falls back to its folder',
        u && u.name === 'unnamed');
}

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
