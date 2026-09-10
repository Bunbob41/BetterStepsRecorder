/**
 * What version of a recording this application can read.
 *
 * The property that matters is not that an old recording opens - it always
 * did. It is that a NEWER one does not: opening it, editing one step and
 * flushing would write the whole file back in this version's shape and
 * silently discard whatever this version has never heard of.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const format = require('../ui/src/main/format');
const { Session } = require('../ui/src/main/session');

let pass = 0, fail = 0;
const check = (n, ok, extra) => {
  if (ok) { pass++; console.log('  PASS ' + n); return; }
  fail++;
  console.log('  FAIL ' + n + (extra ? `
        ${extra}` : ''));
};

console.log('what version a file claims:');
{
  check('what it says', format.versionOf({ v: 1 }) === 1);
  // Every recording that existed before the field was read was version 1.
  check('a file with no version at all is the first one',
        format.versionOf({}) === 1);
  check('and so is one with a null', format.versionOf({ v: null }) === 1);

  // "Something I do not understand wrote this" is exactly when not to write
  // over it, so anything unreadable counts as the future rather than the past.
  check('a version that is not a number is treated as newer',
        format.versionOf({ v: 'two' }) === Infinity);
  check('and so is a nonsense one', format.versionOf({ v: -3 }) === Infinity);
  check('and a missing file entirely', format.versionOf(null) === 1);
}

console.log('\nwhat this application will open:');
{
  check('its own version', format.canRead({ v: format.CURRENT }));
  check('anything older', format.canRead({ v: 1 }));
  check('a file from before the version was read', format.canRead({}));
  check('but not a newer one', !format.canRead({ v: format.CURRENT + 1 }));
  check('and not one it cannot make sense of', !format.canRead({ v: 'later' }));
}

console.log('\nand what it says when it will not:');
{
  const why = format.refusal({ v: format.CURRENT + 5 });
  check('it names the version found', why.includes(String(format.CURRENT + 5)));
  check('and the version it reads', why.includes(String(format.CURRENT)));
  check('it says the recording was left alone', /left alone/.test(why));
  // "Cannot open this recording", with no reason, is the kind of message that
  // makes somebody delete the thing.
  check('and what to do about it', /Update Steps Recorder/.test(why));
  check('an unreadable version is described rather than printed',
        format.refusal({ v: {} }).includes('an unknown version'));
}

console.log('\nopening one, for real:');
{
  const dir = path.join(os.tmpdir(), 'bsr-format-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  const write = (data) =>
    fs.writeFileSync(path.join(dir, 'session.json'), JSON.stringify(data));

  write({ v: format.CURRENT, name: 'Mine', steps: [{ id: 'a', action: 'leftClick' }] });
  const ours = Session.load(dir);
  check('one of this version opens', !ours.unreadable && ours.steps.length === 1);

  write({ name: 'Old', steps: [{ id: 'a', action: 'leftClick' }] });
  const old = Session.load(dir);
  check('one from before the field opens too',
        !old.unreadable && old.steps.length === 1);

  write({ v: format.CURRENT + 1, name: 'Future',
          steps: [{ id: 'a', action: 'somethingNew' }] });
  const future = Session.load(dir);
  check('one from a newer version is refused', Boolean(future.unreadable));
  check('with the reason, not an exception', /newer version/.test(future.unreadable));
  // The whole point: nothing from it is adopted, so nothing can be written
  // back over it.
  check('and none of it is taken in', future.steps.length === 0);

  // And the file is still exactly as it was. Refusing has to mean refusing.
  const before = fs.readFileSync(path.join(dir, 'session.json'), 'utf8');
  Session.load(dir);
  check('the file on disk is untouched',
        fs.readFileSync(path.join(dir, 'session.json'), 'utf8') === before);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nwhat gets written:');
{
  const dir = path.join(os.tmpdir(), 'bsr-format-w-' + Date.now());
  fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });

  const s = new Session(dir);
  s.addStep({ id: 'a', action: 'leftClick', text: 'Click' });
  const written = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));

  check('the version this application writes', written.v === format.CURRENT);

  // The forcing function.
  //
  // `v` has been 1 since the beginning while steps quietly gained marks, a
  // moved marker, an angle, a size, photographs and an excluded flag - so the
  // refusal that exists to protect a recording from an older build has never
  // once fired between two released versions. Not because the format never
  // changed; because nobody was made to decide.
  //
  // Adding a field to the file now fails this check, and the failure asks the
  // question: does this shape change need `format.CURRENT` raised, and a
  // migration written to go with it?
  const keys = Object.keys(written).sort();
  check('and the file has exactly the keys this version owns',
        JSON.stringify(keys) === JSON.stringify([...format.OWNED].sort()),
        `wrote [${keys.join(', ')}], owns [${[...format.OWNED].sort().join(', ')}]`
        + ` - if you added a field, decide whether format.CURRENT must go up`
        + ` and whether migrate() needs to handle the older shape`);
  // One place decides it, so raising the number cannot be half-done.
  check('and it comes from the one place that decides it',
        format.CURRENT === require('../ui/src/main/format').CURRENT);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nwhat a later version left in the file:');
{
  // The case the refusal cannot catch. A recording written by a version that
  // added a top-level field WITHOUT raising the number - which is exactly what
  // this application did to itself six times over - is readable here, and
  // renaming it used to write the file back without that field, silently.
  const dir = path.join(os.tmpdir(), 'bsr-format-f-' + Date.now());
  fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
  const meta = path.join(dir, 'session.json');

  fs.writeFileSync(meta, JSON.stringify({
    v: 1,
    name: 'From later',
    steps: [{ id: 'a', action: 'leftClick', text: 'Click', tomorrow: 'kept too' }],
    // Two things nobody here has heard of: one a scalar, one a structure.
    product: 'HYSWEEP',
    revisions: [{ id: 'r1', note: 'first issue' }],
  }, null, 2), 'utf8');

  const s = Session.load(dir);
  check('a file with unknown fields still opens', !s.unreadable);
  s.rename('Renamed here');                       // any edit flushes

  const after = JSON.parse(fs.readFileSync(meta, 'utf8'));
  check('the rename was written', after.name === 'Renamed here');
  check('and the unknown field survived it', after.product === 'HYSWEEP',
        JSON.stringify(after.product));
  check('structures survive too, unchanged',
        JSON.stringify(after.revisions) === JSON.stringify([{ id: 'r1', note: 'first issue' }]),
        JSON.stringify(after.revisions));
  // Steps are kept whole, which is why the step-level case has always worked -
  // worth pinning, because it is load-bearing and invisible.
  check('an unknown field on a step survives as well',
        after.steps[0].tomorrow === 'kept too');
  check('and the version written is this version, not the one in the file',
        after.v === format.CURRENT);

  // Foreign fields are carried, not obeyed: one named like a field this version
  // owns must not be able to overwrite it.
  fs.writeFileSync(meta, JSON.stringify({ v: 1, name: 'Real name', steps: [],
                                          purpose: 'sop', wild: 1 }), 'utf8');
  const s2 = Session.load(dir);
  s2.rename('Still ours');
  const after2 = JSON.parse(fs.readFileSync(meta, 'utf8'));
  check('a foreign key cannot displace one this version owns',
        after2.name === 'Still ours' && after2.wild === 1);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log('\nthe seam a migration goes in:');
{
  check('a file with no version at all is version 1 after migration',
        format.migrate({ name: 'old' }).v === 1);
  check('and keeps everything it had', format.migrate({ name: 'old' }).name === 'old');
  check('a version that is not a number is not quietly accepted',
        format.migrate({ v: 'banana' }).v === Infinity);
  check('migrating nothing does not throw', format.migrate(null).v === 1);
  // The rule: it runs on the way in, never on a file from the future.
  check('a recording from the future is refused before it is migrated',
        format.canRead({ v: format.CURRENT + 1 }) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
