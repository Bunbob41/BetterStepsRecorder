/**
 * Identifying a build. The property that matters: two builds of the same
 * version must be distinguishable, because the version number does not change
 * between them - it sat at 0.1.0 across a day of changes, and telling two
 * installers apart meant comparing file timestamps by hand.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const b = require('../ui/src/main/build-info');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bsr-build-'));
const stampDir = path.join(tmp, 'ui');
fs.mkdirSync(stampDir, { recursive: true });

function stamp(built, commit = 'abc1234') {
  fs.writeFileSync(path.join(stampDir, 'build-info.json'),
    JSON.stringify({ version: '0.1.0', commit, built, source: 'packaged' }));
}

function engineAt(iso) {
  const exe = path.join(tmp, 'engine.exe');
  fs.writeFileSync(exe, 'x');
  fs.utimesSync(exe, new Date(iso), new Date(iso));
  return exe;
}

console.log('a packaged build:');
{
  stamp('2026-09-05T14:40:00.000Z');
  const info = b.describe({
    version: '0.1.0', projectRoot: tmp,
    engineExe: engineAt('2026-09-05T14:40:05.000Z'),
  });
  check('reports the stamped commit', info.commit === 'abc1234');
  check('reports when it was built', info.built === '2026-09-05T14:40:00.000Z');
  check('knows it is packaged', info.source === 'packaged');
  check('reports the engine separately', info.engineBuilt !== null);
  check('an engine built alongside it is not stale', info.engineStale === false);
}

console.log('\nstaleness is about the engine and its own source:');
{
  // The first version asked "is the engine older than the app?", which is wrong
  // twice over. In a package they ship together, and `dotnet publish` rightly
  // skips a rebuild when nothing changed - so a perfectly current engine keeps
  // an older timestamp than the packaging run around it. The freshly built
  // installer accused itself of shipping a stale engine, in red, on first open.
  stamp('2026-09-05T17:51:00.000Z');
  const packaged = b.describe({
    version: '0.1.0', projectRoot: tmp,
    engineExe: engineAt('2026-09-05T16:16:00.000Z'),
  });
  check('a packaged build never calls its own engine stale',
        packaged.engineStale === false);
  check('even though the engine is older than the package',
        new Date(packaged.engineBuilt) < new Date(packaged.built));
}

console.log('\nin a source tree, where it does matter:');
{
  // The case worth catching: the C# was edited and not rebuilt.
  const src = path.join(tmp, 'capture');
  fs.mkdirSync(src, { recursive: true });
  const cs = path.join(src, 'Recorder.cs');

  fs.rmSync(path.join(stampDir, 'build-info.json'), { force: true });

  fs.writeFileSync(cs, '// edited');
  fs.utimesSync(cs, new Date('2026-09-05T15:40:00.000Z'), new Date('2026-09-05T15:40:00.000Z'));
  const current = b.describe({ version: '0.1.0', projectRoot: tmp,
                               engineExe: engineAt('2026-09-05T16:16:00.000Z') });
  check('an engine built after its source is current', current.engineStale === false);

  fs.utimesSync(cs, new Date('2026-09-05T18:00:00.000Z'), new Date('2026-09-05T18:00:00.000Z'));
  const stale = b.describe({ version: '0.1.0', projectRoot: tmp,
                             engineExe: engineAt('2026-09-05T16:16:00.000Z') });
  check('an engine older than its source is stale', stale.engineStale === true);

  fs.rmSync(src, { recursive: true, force: true });
  const noSource = b.describe({ version: '0.1.0', projectRoot: tmp,
                                engineExe: engineAt('2026-09-05T16:16:00.000Z') });
  check('no source to compare against is not evidence of staleness',
        noSource.engineStale === false);
}

console.log('\nwhen there is no engine to look at:');
{
  stamp('2026-09-05T14:40:00.000Z');
  const info = b.describe({ version: '0.1.0', projectRoot: tmp,
                            engineExe: path.join(tmp, 'missing.exe') });
  check('it says so rather than throwing', info.engineBuilt === null);
  check('and claims no mismatch it cannot know about', info.engineStale === false);
}

console.log('\ntwo builds of the same version:');
{
  stamp('2026-09-05T12:43:00.000Z', 'b515e01');
  const morning = b.summarise(b.describe({ version: '0.1.0', projectRoot: tmp }));
  stamp('2026-09-05T14:40:00.000Z', '6df3e70');
  const afternoon = b.summarise(b.describe({ version: '0.1.0', projectRoot: tmp }));
  check('are not the same string', morning !== afternoon);
  check('both name the version', morning.includes('0.1.0') && afternoon.includes('0.1.0'));
  check('and each names its commit',
        morning.includes('b515e01') && afternoon.includes('6df3e70'));
}

console.log('\nin a source tree, with no stamp:');
{
  fs.rmSync(path.join(stampDir, 'build-info.json'));
  const info = b.describe({ version: '0.1.0', projectRoot: tmp });
  // tmp is not a git repository, so the commit is unknown rather than a crash.
  check('it does not throw', typeof info.commit === 'string');
  check('and says it is not a packaged build', info.source === 'development');
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
