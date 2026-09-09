/**
 * Photographs taken with a camera, brought into a recording.
 *
 * Not everything a procedure needs happens on a screen. Half of the work this
 * tool is used for is physical - a cable in the right socket, a switch in the
 * right position, a serial number on the underside of a unit - and until now a
 * recording could only ever show what a mouse did. The step that says "connect
 * the battery" had no picture and could not have one.
 *
 * Two ways in, because they suit different moments:
 *
 * - **Choose or drag them in**, while the recording is open and you are
 *   writing it up. This is the one you use when you already know which photo
 *   goes where.
 * - **Drop them in the recording's folder**, and they are taken in when it is
 *   next opened. This is the one that matters after a job: the photos come off
 *   a phone or a camera onto the machine in a lump, and nobody wants to add
 *   thirty of them one at a time through a dialog.
 *
 * The original is never destroyed. A photo brought in is resized to 2000 pixels
 * on its long edge and saved as JPEG - a sensible size for a page, and small
 * enough that a recording with forty photos in it can still be emailed - and
 * the file it came from is moved into `originals/` inside the recording rather
 * than deleted. It is somebody's photograph: the recording is allowed to keep a
 * smaller copy for the document, and is not allowed to be the reason the
 * full-sized one no longer exists.
 */
const fs = require('node:fs');
const path = require('node:path');
const { nativeImage } = require('electron');

/** The long edge of a photo once it is in a recording. */
const LONG_EDGE = 2000;
const QUALITY = 82;

/**
 * What can be read.
 *
 * Deliberately short. These are the formats `nativeImage` decodes on Windows,
 * and a file that cannot be decoded is reported rather than skipped in silence
 * - somebody who drops twenty photos in a folder and gets nineteen has to be
 * told which one, and why.
 *
 * HEIC is missing on purpose and is the one people will hit: it is what an
 * iPhone writes by default. Windows cannot decode it without a codec from the
 * Store, and neither can this. Saying so is better than a silent failure.
 */
const READABLE = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp']);
const KNOWN_UNREADABLE = new Set(['.heic', '.heif', '.raw', '.cr2', '.nef', '.arw', '.dng']);

const extensionOf = (file) => path.extname(file || '').toLowerCase();

function looksLikeAPhoto(file) {
  return READABLE.has(extensionOf(file)) || KNOWN_UNREADABLE.has(extensionOf(file));
}

/**
 * A photo, at the size a document wants it.
 *
 * Returns `{ data, ext }`, or `{ error }` saying what a person should do about
 * it. Never throws: one unreadable file out of thirty must not stop the other
 * twenty-nine arriving.
 */
function convert(file, { longEdge = LONG_EDGE, quality = QUALITY } = {}) {
  const ext = extensionOf(file);
  if (KNOWN_UNREADABLE.has(ext)) {
    return { error: `${path.basename(file)} is ${ext.slice(1).toUpperCase()}, `
                  + `which Windows cannot open here. Save it as JPEG first.` };
  }
  if (!READABLE.has(ext)) {
    return { error: `${path.basename(file)} is not an image this can read.` };
  }

  try {
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) {
      return { error: `${path.basename(file)} could not be read - it may be damaged.` };
    }

    // Downscale only, and by the LONG edge: a photograph held the tall way is
    // as common as one held wide, and resizing by width would leave a portrait
    // photo enormous while shrinking a landscape one correctly.
    const { width, height } = img.getSize();
    if (Math.max(width, height) > longEdge) {
      img = width >= height
        ? img.resize({ width: longEdge, quality: 'good' })
        : img.resize({ height: longEdge, quality: 'good' });
    }

    const data = img.toJPEG(quality);
    if (!data || !data.length) {
      return { error: `${path.basename(file)} could not be converted.` };
    }
    return { data, ext: '.jpg', size: img.getSize() };
  } catch (err) {
    return { error: `${path.basename(file)} could not be read: ${err.message}` };
  }
}

/**
 * Photos sitting in a recording's folder that are not part of it yet.
 *
 * Only the top level of the folder is looked at. `steps/` holds the pictures
 * the recording already owns and `originals/` holds the ones it has taken in,
 * so scanning either would import the same photo again on every open - which
 * is the failure this route has to avoid above all others, because it is
 * invisible until the guide has the same picture in it four times.
 */
function waiting(dir) {
  let names;
  try { names = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }

  return names
    .filter((e) => e.isFile() && looksLikeAPhoto(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

/**
 * Brings photographs into an open recording.
 *
 * One function for both ways in - chosen or dragged while it is open, and found
 * in the folder when it is opened - because they must produce identical steps.
 * Two implementations of "what a photo becomes" would drift, and the drift
 * would only ever be visible in somebody's finished manual.
 *
 * The file it came from is MOVED into `originals/` rather than deleted. What
 * goes into the recording is 2000px on the long edge, which is a smaller image
 * than the one that arrived, so deleting the source would make this the reason
 * a full-sized photograph no longer exists. Moving it is also what stops a
 * photo dropped in the folder being taken in again on every opening - the one
 * failure of this route that would be invisible until the same picture appeared
 * in a guide four times.
 *
 * `keepOriginal` is for photos chosen from elsewhere on the disk. Those are not
 * the recording's files to move.
 */
function importInto(session, files, { afterId = null, keepOriginal = false,
                                      onWarn = null } = {}) {
  const added = [];
  const failed = [];
  let after = afterId;

  for (const file of files || []) {
    const converted = convert(file);
    if (converted.error) { failed.push(converted.error); continue; }

    const r = session.addPhoto(converted.data, {
      ext: converted.ext,
      source: path.basename(file),
      afterId: after,
    });
    if (!r) { failed.push(`${path.basename(file)} could not be saved.`); continue; }

    // Each after the last, so a set chosen at once keeps the order it was
    // chosen in rather than arriving reversed.
    after = r.step.id;
    added.push(r);

    if (keepOriginal) continue;
    try {
      const keep = path.join(session.dir, 'originals');
      fs.mkdirSync(keep, { recursive: true });
      fs.renameSync(file, path.join(keep, path.basename(file)));
    } catch (err) {
      // The step is made and the picture is already in the recording; failing
      // to tidy the original away is not worth losing that over. It does mean
      // this photo will be offered again next time, so say so.
      if (onWarn) onWarn(`could not move ${path.basename(file)} into originals: ${err.message}`);
    }
  }

  return { ok: true, added, failed };
}

module.exports = { convert, waiting, importInto, looksLikeAPhoto,
                   LONG_EDGE, QUALITY, READABLE, KNOWN_UNREADABLE };
