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

const win = (p, product) =>
  ({ title: 'w', process: p, product, rect: { x: 0, y: 0, w: 1, h: 1 } });

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
  // Not the filename. A person scanning a list of recordings is trying to
  // remember which is which, and "RocketLeague.exe" is the truth without being
  // an answer.
  check('and the application it was about, named for a person',
        rl && rl.app === 'RocketLeague');
}

console.log('\nthe rest of the listing:');
{
  const found = library.list(root);
  check('both recordings are listed', found.length === 2);
  check('newest first', found[0].savedAt > found[1].savedAt);
  check('notes are not counted as steps',
        found.find((e) => e.app === 'File Explorer').steps === 1);
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
console.log('\nthe count on a card is the number of things to do:');
{
  // It asked "is it not a note", which was the whole question until headings
  // existed - and then counted every heading as a step, so a card promised
  // more work than the recording held.
  const withRows = library.list("C:/R", {
    exists: () => true,
    readdir: () => ['one'],
    readFile: () => JSON.stringify({
      name: 'Mixed', savedAt: '2026-01-01Z',
      steps: [
        { id: 'h', action: 'section', text: 'Prepare' },
        { id: 'a', action: 'leftClick', text: 'Click', window: { process: 'a.exe' } },
        { id: 'n', action: 'note', text: 'Wait' },
        { id: 'b', action: 'leftClick', text: 'Click', window: { process: 'a.exe' } },
        { id: 'h2', action: 'section', text: 'Finish' },
      ],
    }),
  });

  check('headings and notes are not steps', withRows[0].steps === 2);
}

console.log('\nwhich application a recording is called after:');
{
  // A recording almost always begins by clicking something on the taskbar, so
  // taking the FIRST step that named a process labelled every recording
  // "explorer.exe" - naming the way in rather than the thing documented. This
  // is the case from a real recording of Gemini in Chrome.
  makeSession('gemini', {
    name: 'Ask Gemini', savedAt: '2026-09-06T03:10:00.000Z',
    steps: [
      { action: 'leftClick', window: win('explorer.exe') },
      { action: 'leftClick', window: win('chrome.exe', 'Google Chrome') },
      { action: 'leftClick', window: win('chrome.exe', 'Google Chrome') },
      { action: 'leftClick', window: win('chrome.exe', 'Google Chrome') },
    ],
  });

  const found = library.list(root);
  const g = found.find((e) => path.basename(e.dir) === 'gemini');

  check('is the one it spent its time in', g && g.app === 'Google Chrome');
  check('and not the one it started in', g && g.app !== 'File Explorer');

  // A recording made before the engine recorded product names still has to
  // read well, from the filename alone.
  makeSession('older', {
    name: 'Older recording', savedAt: '2026-04-01T00:00:00.000Z',
    steps: [{ action: 'leftClick', window: win('explorer.exe') },
            { action: 'leftClick', window: win('explorer.exe') }],
  });
  const o = library.list(root).find((e) => path.basename(e.dir) === 'older');
  check('an older recording is still named readably',
        o && o.app === 'File Explorer');
}

console.log('\nwhat a recording costs on disk:');
{
  // Screenshots stack up faster than anybody expects: nine real recordings came
  // to 479 MB, and one of them was 403 MB of it. Somebody who cannot see that
  // finds out when a disk fills.
  const dir = makeSession('sized', {
    name: 'Sized', savedAt: '2026-07-01T00:00:00.000Z',
    steps: [{ action: 'leftClick', window: win('chrome.exe', 'Google Chrome') }],
  });
  fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'steps', 'a.png'), Buffer.alloc(3000));
  fs.writeFileSync(path.join(dir, 'steps', 'b.png'), Buffer.alloc(5000));

  const found = library.list(root).find((e) => path.basename(e.dir) === 'sized');
  check('the screenshots are counted', found && found.bytes >= 8000);
  // session.json is part of what the folder costs, so the total is more than
  // the pictures alone.
  check('and so is everything else in the folder', found && found.bytes > 8000);

  // Nested folders count too - the trash a blur leaves behind lives in one.
  fs.mkdirSync(path.join(dir, '.trash'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.trash', 'old.png'), Buffer.alloc(4000));
  const after = library.list(root).find((e) => path.basename(e.dir) === 'sized');
  check('including in folders inside it', after.bytes >= found.bytes + 4000);
}

console.log('\nmeasuring must not cost a recording its place in the list:');
{
  // The size walk used to build a path before guarding it, so one entry it
  // could not make sense of threw past the caller and the whole recording
  // vanished from the listing - the exact failure the folder-name bug caused
  // once already.
  const odd = library.list('C:/anywhere', {
    exists: () => true,
    readdir: () => ['one'],            // strings, not directory entries
    readFile: () => JSON.stringify({
      name: 'Still here', savedAt: '2026-01-01Z',
      steps: [{ action: 'leftClick', window: win('a.exe') }],
    }),
    statOf: () => { throw new Error('no'); },
  });

  check('the recording is still listed', odd.length === 1);
  check('with its name', odd[0].name === 'Still here');
  check('and a size of nothing rather than no recording', odd[0].bytes === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
