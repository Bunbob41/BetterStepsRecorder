/**
 * The invariants ENGINEERING.md claims, checked against the code.
 *
 * Static, like renderer_wiring_test.js, and for the same reason: these are
 * properties that hold across files rather than inside one, so no unit test is
 * positioned to notice when one stops holding. An undo entry pushed with a type
 * nothing handles, a screenshot written without being stashed first, a new
 * place that counts steps by "not a note" and so counts headings — each is a
 * silent defect, and each is a grep away from being caught.
 *
 * These check SHAPE, not behaviour. A passing run means nothing here has
 * drifted; it does not mean the behaviour is right, which is what every other
 * suite is for.
 */
const fs = require('node:fs');
const path = require('node:path');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

let pass = 0, fail = 0;
const check = (n, ok, detail) => {
  if (ok) { pass++; console.log('  PASS ' + n); return; }
  fail++;
  console.log('  FAIL ' + n + (detail ? '\n        ' + detail : ''));
};

const main = read('ui/src/main/main.js');
const exportJs = read('ui/src/main/export.js');
const renderer = read('ui/src/renderer/renderer.js');
const preload = read('ui/src/main/preload.js');

/**
 * Every module that could count steps, found rather than listed.
 *
 * The listed version named three files and missed `library.js`, which had been
 * counting headings as steps since headings existed. A check that has to be
 * remembered is a check that will be forgotten.
 */
function sourceFiles() {
  const roots = ['ui/src/main', 'ui/src/renderer'];
  const out = [];
  for (const root of roots) {
    const dir = path.join(__dirname, '..', root);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.js')) out.push([`${root}/${f}`, read(`${root}/${f}`)]);
    }
  }
  return out;
}

console.log('every undo entry can actually be undone:');
{
  // An entry whose type the handler does not match falls through to
  // `{ ok: false }` — the user presses Ctrl+Z and nothing happens, with no
  // error and the entry consumed.
  const pushed = [...main.matchAll(/pushUndo\(\{\s*\n?\s*type: '(\w+)'/g)].map((m) => m[1]);
  const handled = [...main.matchAll(/entry\.type === '(\w+)'/g)].map((m) => m[1]);

  check(`there are undo types to check (${pushed.length})`, pushed.length >= 4);
  for (const t of new Set(pushed)) {
    check(`'${t}' is handled`, handled.includes(t),
          `pushUndo pushes '${t}' and edit:undo never matches it`);
  }
  const dead = handled.filter((t) => !pushed.includes(t));
  check('and no handler is for an entry nothing pushes', dead.length === 0, dead.join());
}

console.log('\na stashed screenshot is always released:');
{
  // tokensOf feeds session.discard() when an entry falls off the end of the
  // stack. An entry holding its token in a shape tokensOf cannot see leaks the
  // file for the rest of the session.
  const at = main.indexOf('function tokensOf');
  const body = main.slice(at, main.indexOf('}', main.indexOf('return entry.token')));

  check('the collective shape is special-cased', /deleteMany/.test(body));
  check('and every other shape is read generically', /entry\.token/.test(body));

  // So the only way to leak is an entry that stashes but names its token
  // something else.
  const odd = [...main.matchAll(/pushUndo\(\{[^}]*?(stashToken|tokens)\s*:/g)];
  check('no entry names its token something tokensOf cannot see', odd.length === 0);
}

console.log('\nthe bridge is wired end to end:');
{
  const exposed = [...preload.matchAll(/^\s{2}(\w+):\s*\(/gm)].map((m) => m[1]);
  const invoked = [...preload.matchAll(/ipcRenderer\.invoke\('([\w:]+)'/g)].map((m) => m[1]);
  const handled = [...main.matchAll(/ipcMain\.handle\('([\w:]+)'/g)].map((m) => m[1]);

  const missing = invoked.filter((c) => !handled.includes(c));
  check('every channel the bridge invokes has a handler', missing.length === 0,
        'no handler for: ' + missing.join());

  const unreachable = handled.filter((c) => !invoked.includes(c));
  check('and no handler is unreachable', unreachable.length === 0,
        'nothing invokes: ' + unreachable.join());

  const called = [...new Set([...renderer.matchAll(/window\.bsr\.(\w+)/g)].map((m) => m[1]))];
  const undefinedCalls = called.filter((u) => !exposed.includes(u));
  check('every bsr.* the page calls is exposed', undefinedCalls.length === 0,
        'not on the bridge: ' + undefinedCalls.join());
}

console.log('\nexcluded steps do not leak into a document:');
{
  check('images are copied from exportable(), not from every step',
        /for \(const step of exportable\(session\)\)/.test(exportJs));
  check('and exportable() drops them first',
        /filter\(\(s\) => !s\.excluded\)/.test(exportJs));
}

console.log('\na screenshot is never written except atomically:');
{
  const at = main.indexOf('function rewriteScreenshot');
  const body = main.slice(at, at + 1000);

  check('it writes beside the original and renames over it',
        /\.tmp/.test(body) && /renameSync/.test(body));
  check('it stashes the old pixels before writing the new',
        body.indexOf('stash(') < body.indexOf('writeFileSync'));
  check('and gives the stash back if the write fails', /discard\(token\)/.test(body));

  // Anything else writing a screenshot path would bypass all three.
  const direct = [...main.matchAll(/writeFileSync\(([^)]*)\)/g)]
    .map((m) => m[1])
    .filter((a) => /step\.screenshot|shotPath/.test(a));
  check('nothing else writes a screenshot directly', direct.length === 0, direct.join());
}

console.log('\nheadings are not counted as steps:');
{
  // The count a reader is given has to be the number of things to do. Before
  // headings existed the test for "is this a step" was action !== 'note', and
  // any survivor of that counts a heading.
  const survivors = sourceFiles()
    .map(([name, src]) => [name, [...src.matchAll(/action !== 'note'/g)].length])
    .filter(([, n]) => n > 0);

  check(`every module was looked at (${sourceFiles().length})`,
        sourceFiles().length >= 15);
  check('nothing still asks "is it not a note"', survivors.length === 0,
        survivors.map(([f, n]) => `${f}: ${n}`).join(', '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
