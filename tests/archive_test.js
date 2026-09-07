/**
 * Searching every recording rather than the open one.
 *
 * The properties that matter: a recording is findable by the name a person
 * actually sees, the archive and the open recording never disagree about what
 * matches, and one unreadable folder does not cost you the search.
 */
const path = require('node:path');
const { search, SNIPPETS } = require('../ui/src/main/archive');
const find = require('../ui/src/renderer/find');

let pass = 0, fail = 0;
const check = (n, ok) => { ok ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const ROOT = 'C:/Recordings';

const step = (text, app = 'chrome.exe') =>
  ({ id: 't' + Math.random(), action: 'leftClick', text, window: { process: app } });
const note = (text) => ({ id: 'n' + Math.random(), action: 'note', text });
const head = (text) => ({ id: 'h' + Math.random(), action: 'section', text });

/** A fake disk: folder name -> session.json contents, or null for unreadable. */
function disk(folders) {
  return {
    readdir: () => Object.keys(folders),
    exists: (p) => {
      const norm = String(p).replace(/\\/g, '/');
      if (norm === ROOT) return true;
      const m = norm.match(/^.*\/([^/]+)\/session\.json$/);
      if (m) return Object.prototype.hasOwnProperty.call(folders, m[1]);
      return Object.prototype.hasOwnProperty.call(folders, norm.split('/').pop());
    },
    readFile: (p) => {
      const folder = String(p).replace(/\\/g, '/').split('/').slice(-2)[0];
      const data = folders[folder];
      if (data === null) return '{ not json';
      return JSON.stringify(data);
    },
  };
}

const FOLDERS = {
  'session-1': {
    name: 'Set up the VPN', savedAt: '2026-01-01T00:00:00Z',
    steps: [step('Clicked the "Connect" button'), step('Typed the VPN address'),
            head('Check it works'), note('Wait for the tunnel')],
  },
  'session-2': {
    name: 'Invoice approval', savedAt: '2026-03-01T00:00:00Z',
    steps: [step('Clicked Save', 'EXCEL.EXE'), step('Clicked Send', 'EXCEL.EXE')],
  },
  'RL': {
    // No name in the file: the folder's name is what a person sees.
    savedAt: '2026-02-01T00:00:00Z',
    steps: [step('Clicked Play', 'RocketLeague.exe')],
  },
  'broken': null,
};

console.log('finding the recording you meant:');
{
  const r = search(ROOT, 'VPN', disk(FOLDERS));
  check('finds it', r.length === 1);
  check('by the name a person sees', r[0].name === 'Set up the VPN');
  check('and says where it is', r[0].dir === path.join(ROOT, 'session-1'));
  // Twice: once in the name, once in a step.
  check('counting every occurrence', r[0].total === 2);
  check('and flagging that the name itself matched', r[0].inName === true);
}

console.log('\nwhat gets searched:');
{
  check('recorded steps', search(ROOT, 'Connect', disk(FOLDERS)).length === 1);
  check('written notes', search(ROOT, 'tunnel', disk(FOLDERS)).length === 1);
  check('section headings', search(ROOT, 'Check it works', disk(FOLDERS)).length === 1);
  // A recording named after its folder must still be findable by that name.
  check('a folder name, when the file has no name of its own',
        search(ROOT, 'RL', disk(FOLDERS)).some((x) => x.name === 'RL'));
  check('and nothing matches nothing', search(ROOT, 'zebra', disk(FOLDERS)).length === 0);
}

console.log('\nit agrees with the search inside a recording:');
{
  // Same matcher, so the same literal-not-a-pattern rule holds. A search for
  // "." must not match every character in the archive.
  const dots = disk({ a: { name: 'a', steps: [step('a.b')] },
                      b: { name: 'b', steps: [step('axb')] } });
  check('a full stop is a full stop', search(ROOT, 'a.b', dots).length === 1);

  check('case is ignored by default', search(ROOT, 'vpn', disk(FOLDERS)).length === 1);
  check('and respected when asked',
        search(ROOT, 'vpn', { ...disk(FOLDERS), caseSensitive: true }).length === 0);

  const words = disk({ a: { name: 'a', steps: [step('Save the Saved file')] } });
  check('whole words are whole words',
        search(ROOT, 'Save', { ...words, wholeWord: true })[0].total === 1);
}

console.log('\nwhat comes back, and in what order:');
{
  const many = disk({
    few: { name: 'few', savedAt: '2026-05-01Z', steps: [step('alpha')] },
    lots: { name: 'lots', savedAt: '2026-01-01Z',
            steps: [step('alpha'), step('alpha alpha'), head('alpha')] },
    same: { name: 'same', savedAt: '2026-09-01Z', steps: [step('alpha')] },
  });
  const r = search(ROOT, 'alpha', many);

  check('the recording most about it comes first', r[0].name === 'lots');
  check('and ties break on recency', r[1].name === 'same' && r[2].name === 'few');

  check('each hit says which step it is in',
        r[0].hits[0].id && typeof r[0].hits[0].index === 'number');
  check('and carries the text to show', r[0].hits[0].text.includes('alpha'));

  // A way in, not the whole recording.
  const wide = disk({ w: { name: 'w', steps: Array.from({ length: 12 }, () => step('alpha')) } });
  const one = search(ROOT, 'alpha', wide)[0];
  check(`only a few snippets come back (${one.hits.length})`, one.hits.length === SNIPPETS);
  check('but the true total is reported', one.total === 12);
  check('and it says how many were not shown', one.more === 12 - SNIPPETS);
}

console.log('\nheadings are not counted as steps:');
{
  // The count on a result is the number of things to do, as everywhere else.
  const r = search(ROOT, 'VPN', disk(FOLDERS));
  check('a heading and a note do not inflate it', r[0].steps === 2);
}

console.log('\nnothing costs you the search:');
{
  // 'broken' holds invalid JSON and sits in the middle of the folder list.
  check('an unreadable recording is skipped, not fatal',
        search(ROOT, 'VPN', disk(FOLDERS)).length === 1);

  check('an empty query finds nothing rather than everything',
        search(ROOT, '', disk(FOLDERS)).length === 0);
  check('and so does whitespace', search(ROOT, '   ', disk(FOLDERS)).length === 0);
  check('a missing folder is not an error',
        search('C:/nowhere', 'x', { ...disk(FOLDERS), exists: () => false }).length === 0);
  check('and neither is no folder at all', search(null, 'x', disk(FOLDERS)).length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
