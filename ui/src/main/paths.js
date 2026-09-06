/**
 * Keeping a recording's file references inside the recording.
 *
 * A recording is a folder, and the whole point of it is that it can be handed
 * to somebody else. So `session.json` is not our data: it is a file that
 * arrived from outside, and every path in it is an assertion by whoever wrote
 * it rather than a fact.
 *
 * A step's `screenshot` is joined to the session directory in several places -
 * to read it, to serve it to the window, and to write over it when a region is
 * blurred or cropped. `path.join` resolves `..` cheerfully, so a crafted
 * recording could name `../../../secrets.txt` and have the application read it,
 * serve it, or replace it with a blurred screenshot. The write is the one that
 * matters: opening a recording someone sent you and blurring one step is an
 * ordinary thing to do.
 *
 * `startsWith` is not the check. `C:\Recordings\session-10` starts with
 * `C:\Recordings\session-1`, so a sibling recording passes it. `path.relative`
 * is the check: it answers "how would I get from here to there", and any answer
 * that begins by going up is outside.
 */
const path = require('node:path');

/** Whether `target` is `dir` itself or something within it. */
function insideDir(dir, target) {
  if (!dir || !target) return false;
  const rel = path.relative(path.resolve(dir), path.resolve(target));
  // '' is the directory itself; anything starting with '..' has climbed out,
  // and an absolute answer means a different drive entirely.
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Joins a relative reference to a directory, or returns null if it escapes.
 *
 * Null rather than throwing: every caller of this is already written to cope
 * with a screenshot that is not there, and a recording with one bad path
 * should lose that one picture rather than fail to open.
 */
function safeJoin(dir, relative) {
  if (!dir || typeof relative !== 'string' || !relative) return null;
  // An absolute reference is never valid here - these are always relative to
  // the recording, and accepting one would sidestep the check entirely.
  if (path.isAbsolute(relative)) return null;
  const target = path.join(dir, relative);
  return insideDir(dir, target) ? target : null;
}

/** Whether a step's screenshot reference is one this recording may name. */
const safeReference = (relative) =>
  typeof relative === 'string' && relative !== ''
  && !path.isAbsolute(relative)
  && !path.relative('.', path.join('.', relative)).startsWith('..');

module.exports = { insideDir, safeJoin, safeReference };
