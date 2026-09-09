/**
 * What version of a recording this application can read.
 *
 * A recording is a folder people hand to each other, and this is the moment
 * that stops being theoretical: once somebody else has twenty recordings, the
 * shape of `session.json` is a promise rather than an internal detail. The
 * field has been written as `v: 1` since the beginning and nothing ever read
 * it, which is a version number that means nothing.
 *
 * Three cases, and only the third is interesting:
 *
 *   OLDER  - migrated forward, silently. A recording made before headings
 *            existed is simply a recording with no headings in it; nothing has
 *            ever been removed from a step, only added, so reading an old one
 *            needs no work beyond knowing that.
 *   SAME   - opened.
 *   NEWER  - refused, with an explanation. This is the case that matters. A
 *            recording from a later version may contain steps of a kind this
 *            application has never heard of, and the damage is not in failing
 *            to show them - it is that opening it, editing one step and
 *            flushing would write the whole file back in THIS version's shape
 *            and silently destroy whatever it did not understand.
 *
 * Refusing to open is the only safe answer to "newer", and saying why is the
 * difference between a bug and a message.
 */

/** The shape this application writes. Raise it when a step gains a field. */
const CURRENT = 1;

/**
 * The version a loaded file claims.
 *
 * A file with no `v` at all predates the field and is version 1: that is what
 * every recording in existence at the time was.
 */
function versionOf(data) {
  const v = data && data.v;
  if (v === undefined || v === null) return 1;
  const n = Number(v);
  // A version that is not a number is not a version. Treating it as the
  // future is the cautious reading: it means "something I do not understand
  // wrote this", which is exactly when not to write over it.
  return Number.isInteger(n) && n > 0 ? n : Infinity;
}

/** Whether this application can safely open and write back a recording. */
const canRead = (data) => versionOf(data) <= CURRENT;

/**
 * What to tell somebody whose recording is from a later version.
 *
 * Names the versions, because "cannot open this recording" with no reason is
 * the kind of message that makes people delete things.
 */
function refusal(data) {
  const found = versionOf(data);
  const claimed = Number.isFinite(found) ? `version ${found}` : 'an unknown version';
  return `This recording was made by a newer version of Steps Recorder `
       + `(${claimed}; this one reads up to version ${CURRENT}). `
       + `Opening it here could discard the parts this version does not `
       + `understand, so it has been left alone. Update Steps Recorder to `
       + `open it.`;
}

/**
 * What to tell somebody whose recording will not parse.
 *
 * Distinct from `refusal`, which is about a version this build is too old for.
 * This one is damage: a byte order mark an editor added, a write cut short by a
 * crash, a file somebody hand-edited. The wording says the recording was left
 * alone, because the screenshots are still there and the folder is still worth
 * keeping.
 */
function damaged() {
  return 'The details of this recording could not be read - the file may be '
       + 'damaged or have been edited by hand. Nothing has been changed, and '
       + 'the screenshots are still in the folder.';
}

/**
 * The same two situations, in a few words.
 *
 * The full sentences above are what somebody is told when they try to open the
 * recording. A row in the list has space for a phrase, and the phrase has to
 * distinguish them: the renderer used to hard-code "Made by a newer version"
 * for anything flagged, which was true while that was the only way to be
 * flagged and became a lie the moment damage was another.
 */
const REFUSAL_LABEL = 'Made by a newer version \u2014 cannot be opened here';
const DAMAGED_LABEL = 'Damaged \u2014 left alone; the screenshots are still there';

module.exports = {
  CURRENT, versionOf, canRead, refusal, damaged, REFUSAL_LABEL, DAMAGED_LABEL,
};
