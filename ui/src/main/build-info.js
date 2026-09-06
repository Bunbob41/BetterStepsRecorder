const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

/**
 * Which build of this application is actually running.
 *
 * The version number on its own does not answer that. It sat at 0.1.0 across
 * six commits in a single afternoon, so two installers that behaved quite
 * differently - one of which put the recording strip into every screenshot -
 * both reported "0.1.0". Telling them apart meant comparing file timestamps on
 * disk by hand.
 *
 * So a build is identified by version, commit and build time together. The
 * capture engine is reported separately, because it is compiled independently
 * of the interface and the two can drift: a rebuilt interface talking to a
 * stale engine looks like the fix did not work.
 */

/** Written by scripts/stamp-build.js during a packaged build. */
function stamped(projectRoot) {
  // Deliberately not relative to __dirname: that ignores projectRoot and would
  // report a stamp from an unrelated tree as if it described this one.
  for (const file of [path.join(process.resourcesPath || '', 'build-info.json'),
                      path.join(projectRoot || '', 'ui', 'build-info.json')]) {
    try {
      if (file && fs.existsSync(file)) {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      }
    } catch { /* fall through to the next candidate */ }
  }
  return null;
}

/** In a source tree there is no stamp, so ask git directly. */
function fromGit(projectRoot) {
  try {
    // stderr ignored: outside a repository git complains, and that is an
    // answer ("unknown"), not something to print over the application's log.
    const opts = { cwd: projectRoot, encoding: 'utf8',
                   stdio: ['ignore', 'pipe', 'ignore'] };
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], opts).trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], opts).trim().length > 0;
    const build = execFileSync('git', ['rev-list', '--count', 'HEAD'], opts).trim();
    return { commit: dirty ? `${commit}+` : commit,
             build: Number(build) || 0, source: 'development' };
  } catch {
    return { commit: 'unknown', source: 'development' };
  }
}

/**
 * `engineExe` is the resolved capture engine, whose own build time is taken
 * from the file: it has no version of its own and this is what catches a stale
 * one after only the interface was rebuilt.
 */
function describe({ version, projectRoot, engineExe }) {
  const stamp = stamped(projectRoot) || fromGit(projectRoot);

  let engineBuilt = null;
  try {
    if (engineExe && fs.existsSync(engineExe)) {
      engineBuilt = fs.statSync(engineExe).mtime.toISOString();
    }
  } catch { /* an unreadable engine is reported as unknown, not as an error */ }

  return {
    version,
    // The number a person reads. It increases with every change, which the
    // version does not: 0.1.0 covered a whole day of builds that behaved
    // differently from one another.
    build: stamp.build || 0,
    commit: stamp.commit || 'unknown',
    built: stamp.built || null,
    source: stamp.source || 'packaged',
    engineBuilt,
    engineStale: engineIsStale({
      projectRoot, engineBuilt, source: stamp.source || 'packaged',
    }),
  };
}

/**
 * Whether the engine binary predates the engine's own source.
 *
 * The obvious check - is the engine older than the app? - is wrong twice over.
 * In a package the two ship together inside one installer, so the engine cannot
 * meaningfully be stale; and `dotnet publish` rightly skips a rebuild when
 * nothing has changed, so an engine that is perfectly current keeps an older
 * timestamp than the packaging run around it. That comparison had the freshly
 * built installer accusing itself of shipping a stale engine.
 *
 * What actually matters, and only in a source tree, is whether the engine was
 * built since the last time its source changed - the "I edited the C# and
 * forgot to rebuild" case, which is a genuinely confusing afternoon.
 */
function engineIsStale({ projectRoot, engineBuilt, source }) {
  if (source === 'packaged' || !engineBuilt || !projectRoot) return false;

  try {
    const dir = path.join(projectRoot, 'capture');
    const newest = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.cs'))
      .map((f) => fs.statSync(path.join(dir, f)).mtimeMs)
      .reduce((a, b) => Math.max(a, b), 0);

    // A second of slack: a build writes the binary moments after reading source.
    return newest > new Date(engineBuilt).getTime() + 1000;
  } catch {
    // No source to compare against is not evidence of staleness.
    return false;
  }
}

/**
 * One line for the log. Plain ASCII on purpose: the log is opened by whatever
 * tool is to hand, and a middot written as UTF-8 comes back as mojibake in
 * anything that assumes the system codepage. The interface builds its own line
 * with proper typography.
 */
function summarise(info) {
  const when = info.built
    ? new Date(info.built).toLocaleString()
    : info.source;
  const parts = [`Steps Recorder build ${info.build}`, info.version,
                 info.commit, when];
  return parts.filter(Boolean).join(' | ');
}

module.exports = { describe, summarise };
