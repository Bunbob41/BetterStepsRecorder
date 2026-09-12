/**
 * The renderer resolves every element by id at load. A typo or a control that
 * was never added to the markup throws immediately and the window comes up
 * blank — a failure no logic test would catch and, without driving the UI, one
 * that would otherwise only surface in front of a user.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'ui', 'src', 'renderer');
const js = fs.readFileSync(path.join(root, 'renderer.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const declared = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const used = [...js.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]);

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

console.log(`renderer looks up ${used.length} elements; markup declares ${declared.size}`);

const missing = [...new Set(used)].filter((id) => !declared.has(id));
check('every element the renderer resolves exists in the markup'
      + (missing.length ? `: missing ${missing.join(', ')}` : ''), missing.length === 0);

// Handlers referencing an element that was never captured into `el`.
const captured = new Set([...js.matchAll(/(\w+):\s*\$\('/g)].map((m) => m[1]));
const referenced = new Set([...js.matchAll(/\bel\.(\w+)\b/g)].map((m) => m[1]));
const dangling = [...referenced].filter((k) => !captured.has(k));
check('every el.* reference was captured'
      + (dangling.length ? `: ${dangling.join(', ')}` : ''), dangling.length === 0);

// The preload bridge is the only path to the main process; a call to something
// it does not expose is undefined at runtime.
const preload = fs.readFileSync(path.join(__dirname, '..', 'ui', 'src', 'main', 'preload.js'), 'utf8');
const exposed = new Set([...preload.matchAll(/^\s*(\w+):\s*\(/gm)].map((m) => m[1]));
const calls = [...new Set([...js.matchAll(/window\.bsr\.(\w+)\(/g)].map((m) => m[1]))];
const unexposed = calls.filter((c) => !exposed.has(c));
check(`all ${calls.length} bridge calls are exposed by preload`
      + (unexposed.length ? `: ${unexposed.join(', ')}` : ''), unexposed.length === 0);

// And every exposed channel must have a handler in main.
const main = fs.readFileSync(path.join(__dirname, '..', 'ui', 'src', 'main', 'main.js'), 'utf8');
const channels = [...new Set([...preload.matchAll(/ipcRenderer\.invoke\('([^']+)'/g)].map((m) => m[1]))];
const handled = new Set([...main.matchAll(/ipcMain\.handle\('([^']+)'/g)].map((m) => m[1]));
const orphaned = channels.filter((c) => !handled.has(c));
check(`all ${channels.length} invoke channels have a handler`
      + (orphaned.length ? `: ${orphaned.join(', ')}` : ''), orphaned.length === 0);

// Every format the Export dialog offers must be one the main process can
// actually produce. The two lists are in different files and different
// languages, and nothing else connects them: a format added to the dropdown and
// not to runExport gives a save dialog with no file filters and then writes
// nothing, reporting success.
const offered = [...html.matchAll(/<option value="([^"]+)"[^>]*>/g)]
  .map((m) => m[1])
  // The Format select is the only one with these values; the others are
  // settings, matched out by looking only at what runExport knows about.
  .filter((v) => /^(html|pdf|md|tex|texdoc|template|docx|latex)$/.test(v));
const filters = main.match(/const filters = \{([\s\S]*?)\}\[format\];/);
const produced = new Set(
  filters ? [...filters[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]) : []);
const unproducible = [...new Set(offered)].filter((f) => !produced.has(f));
check(`all ${new Set(offered).size} offered export formats can be produced`
      + (unproducible.length ? `: ${unproducible.join(', ')}` : ''),
      offered.length > 0 && unproducible.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
