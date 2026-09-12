/**
 * Settings: what survives a settings file somebody edited by hand.
 *
 * This module had no tests. It is the one place where a value from outside the
 * program is trusted enough to be painted straight into the window, and the
 * clamping is what stands between a mistyped number and an unusable layout - so
 * it is worth saying out loud what the bounds are.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings, DEFAULTS } = require('../ui/src/main/settings');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (extra ? '  -> ' + extra : '')); }
};

const bench = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-settings-'));
const docs = path.join(bench, 'Documents');

/** A Settings whose file already holds `raw`. */
function withFile(raw) {
  const dir = fs.mkdtempSync(path.join(bench, 'u-'));
  if (raw !== undefined) {
    fs.writeFileSync(path.join(dir, 'settings.json'),
                     typeof raw === 'string' ? raw : JSON.stringify(raw), 'utf8');
  }
  return new Settings(dir, { documentsDir: docs });
}

console.log('a settings file that was never written:');
{
  const s = withFile(undefined);
  check('falls back to the defaults', s.values.imageFormat === DEFAULTS.imageFormat);
  check('and puts recordings under the real Documents folder',
        s.values.saveRoot === path.join(docs, 'StepRecordings'));
}

console.log('\na settings file from an older version:');
{
  // The merge over defaults is what stops a key added later reading undefined.
  const s = withFile({ imageFormat: 'jpeg' });
  check('keeps what it says', s.values.imageFormat === 'jpeg');
  check('and gains the keys it predates', s.values.stepsWidth === 320);
}

console.log('\na settings file that is not settings at all:');
{
  check('unreadable JSON is ignored rather than fatal',
        withFile('{ not json').values.stepsWidth === 320);
}

console.log('\nthe steps column width is kept usable:');
{
  // Narrower than this and a step title cannot be read; wider and the
  // screenshot stops being the subject of the window.
  check('a hand-edited width far too wide is brought back',
        withFile({ stepsWidth: 99999 }).values.stepsWidth === 480);
  check('and one far too narrow is too',
        withFile({ stepsWidth: 5 }).values.stepsWidth === 200);
  check('a width in range is left exactly alone',
        withFile({ stepsWidth: 407 }).values.stepsWidth === 407);
  check('a fractional width is settled to whole pixels',
        withFile({ stepsWidth: 300.6 }).values.stepsWidth === 301);
  // Zero is the interesting one: `Number(0) || 320` would call it missing and
  // hand back 320, when what was asked for was "as narrow as possible".
  check('zero means as narrow as allowed, not "unset"',
        withFile({ stepsWidth: 0 }).values.stepsWidth === 200);
  check('and something that is not a number at all falls back',
        withFile({ stepsWidth: 'wide' }).values.stepsWidth === 320);
  check('as does nothing at all', withFile({}).values.stepsWidth === 320);
}

console.log('\nwhat the window saves is clamped on the way in too:');
{
  const s = withFile({});
  s.update({ stepsWidth: 9000 });
  check('an out-of-range write is brought back', s.values.stepsWidth === 480);
  check('and written to disk already clamped',
        JSON.parse(fs.readFileSync(s.file, 'utf8')).stepsWidth === 480);
  // Reopening must agree with what was saved, or the width moves on restart.
  check('so reopening finds the same width',
        new Settings(path.dirname(s.file), { documentsDir: docs }).values.stepsWidth === 480);
}

fs.rmSync(bench, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
