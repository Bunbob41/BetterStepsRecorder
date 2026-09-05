const fs = require('node:fs');

/**
 * Preparing a recording's screenshots to go inside a document.
 *
 * Screenshots are stored as PNG because that is right for the usual subject: an
 * application window full of text, where PNG is both crisp and small. It is
 * exactly wrong for a photographic or 3D subject. A single 1920x1080 frame of a
 * game is about 4.5MB as a PNG and about 250KB as a JPEG that looks the same to
 * the reader.
 *
 * A 106 step recording of such frames is 412MB on disk. Base64 inflates that to
 * 550MB of text, and JavaScript cannot hold a string that long - V8's ceiling is
 * 512MB - so the HTML export threw "Invalid string length" and wrote nothing at
 * all. Even if it had fit, nobody can open a 550MB web page, and the same bytes
 * would have gone into a .docx as a zip entry.
 *
 * So the rule is: embed the originals while they fit, and re-encode when they
 * do not. Re-encoding is never done to a recording on disk - only to the copy
 * going into a document. The originals are the record.
 */

/** V8's maximum string length, which is what a base64 export must fit inside. */
const MAX_STRING = 536870888;

/** Base64 costs four characters for every three bytes. */
const BASE64_RATIO = 4 / 3;

/**
 * How much image data we are willing to put inside one document before
 * re-encoding. Comfortably below any limit; the point is a file a person can
 * actually open and email, not the largest one we could technically produce.
 */
const EMBED_BUDGET = 48 * 1024 * 1024;

/** Headroom for the markup, the CSS and base64 line overhead. */
const MARKUP_HEADROOM = 4 * 1024 * 1024;

/** Whether this many bytes of image data can be base64'd into one string. */
function canEmbed(bytes, limit = MAX_STRING) {
  return bytes * BASE64_RATIO + MARKUP_HEADROOM < limit;
}

function sizeOnDisk(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

/** Total bytes of a set of files. */
function totalBytes(files, sizeOf = sizeOnDisk) {
  return files.reduce((sum, f) => sum + sizeOf(f), 0);
}

/**
 * Decides how a document should carry these screenshots.
 *
 * `transcode` is injected rather than imported so this module stays testable
 * without Electron: it takes a path and returns { data, mime, ext } or null.
 *
 * Returns:
 *   mode    'original'   the files as they are on disk
 *           'transcoded' re-encoded copies, in `images`
 *   images  Map of absolute path -> { data, mime, ext }, or null for 'original'
 *   before / after  byte totals, for telling the user what happened
 */
function prepare(files, { sizeOf = sizeOnDisk, transcode = null,
                          budget = EMBED_BUDGET } = {}) {
  const before = totalBytes(files, sizeOf);

  // The common case: a recording of ordinary application windows. Leave the
  // PNGs alone, because re-encoding text to JPEG makes it fuzzy for no gain.
  if (before <= budget || !transcode) {
    return { mode: 'original', images: null, before, after: before };
  }

  const images = new Map();
  let after = 0;
  for (const file of files) {
    const out = transcode(file);
    // A screenshot that cannot be re-encoded keeps its original; one unreadable
    // file must not cost the user the whole export.
    if (!out || !out.data) {
      after += sizeOf(file);
      continue;
    }
    images.set(file, out);
    after += out.data.length;
  }

  return { mode: 'transcoded', images, before, after };
}

/** What to tell the user, or null when nothing worth saying happened. */
function describe(prep) {
  if (prep.mode !== 'transcoded') return null;
  const mb = (n) => `${(n / 1048576).toFixed(0)}MB`;
  return `Screenshots were re-encoded to keep the file usable `
       + `(${mb(prep.before)} to ${mb(prep.after)}).`;
}

module.exports = {
  MAX_STRING, EMBED_BUDGET, canEmbed, totalBytes, prepare, describe,
};
