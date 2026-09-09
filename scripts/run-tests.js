/**
 * Runs every plain-node test suite and reports one line each.
 *
 * A runner rather than a shell loop, because the loop in the README was
 * `for f in tests/*_test.js; do node "$f"; done` - which is bash, and this is a
 * Windows project whose author uses PowerShell 5.1, where it is a parse error.
 * `node scripts/run-tests.js` is the same command in every shell.
 *
 * window_test.js is deliberately not here: it needs a real Electron window,
 * so it is run separately (see the README).
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'tests');
const NEEDS_A_WINDOW = new Set(
  ['window_test.js', 'composite_test.js', 'diagrams_test.js', 'photos_image_test.js']);

const suites = fs.readdirSync(DIR)
  .filter((f) => f.endsWith('_test.js') && !NEEDS_A_WINDOW.has(f))
  .sort();

let failed = 0;
let checks = 0;

for (const file of suites) {
  const r = spawnSync(process.execPath, [path.join(DIR, file)],
                      { encoding: 'utf8', cwd: ROOT });
  const out = (r.stdout || '') + (r.stderr || '');
  const tally = out.match(/(\d+) passed, (\d+) failed/);
  if (tally) checks += Number(tally[1]) + Number(tally[2]);

  const name = file.padEnd(26);
  if (r.status === 0) {
    console.log(`  ok    ${name}${tally ? tally[0] : ''}`);
    continue;
  }

  failed++;
  console.log(`  FAIL  ${name}${tally ? tally[0] : '(did not finish)'}`);
  // Only the failing lines: a whole suite's output buries them.
  for (const line of out.split('\n').filter((l) => /^\s*FAIL/.test(l))) {
    console.log('        ' + line.trim());
  }
  if (!tally) console.log('        ' + out.trim().split('\n').slice(-3).join('\n        '));
}

console.log(`\n${suites.length - failed}/${suites.length} suites, ${checks} checks`
            + (failed ? ` — ${failed} FAILED` : ' — all passed'));
console.log('Needing a window: npm run test:window, npm run test:composite,'
            + ' npm run test:photos, npm run test:diagrams (from ui/)');
process.exit(failed ? 1 : 0);
