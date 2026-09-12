const { nativeImage } = require('electron');

/**
 * Re-encoding a screenshot for a document.
 *
 * Separated from screenshots.js, which decides *whether* to re-encode and must
 * stay free of Electron so it can be tested with plain node. This half is the
 * part that cannot: it needs a real image decoder.
 *
 * JPEG rather than PNG, because the screenshots that force a re-encode are
 * photographic or 3D, where PNG faithfully and enormously stores every pixel of
 * noise. Text-heavy application windows never reach here - they fit as PNG, and
 * re-encoding them would only make the text fuzzy.
 */
function encode(img, maxWidth, quality) {
  if (!img || img.isEmpty()) return null;

  // Downscale only. A screenshot narrower than this is already reasonable,
  // and enlarging it would add bytes without adding detail.
  let out = img;
  if (out.getSize().width > maxWidth) {
    out = out.resize({ width: maxWidth, quality: 'good' });
  }

  const data = out.toJPEG(quality);
  return data && data.length ? { data, mime: 'image/jpeg', ext: '.jpg' } : null;
}

function toJpeg(file, { maxWidth = 1600, quality = 80 } = {}) {
  try {
    return encode(nativeImage.createFromPath(file), maxWidth, quality);
  } catch {
    // An unreadable screenshot must not cost the user the whole export.
    return null;
  }
}

/**
 * The same, for a picture that is already in hand rather than on disk.
 *
 * The click marker is drawn INTO the pixels for documents that cannot lay
 * anything over an image (D-31), so by the time a LaTeX export knows what it is
 * shipping, the marked screenshots are buffers and never had a file of their
 * own. Sizing them means starting from those bytes - and it has to happen after
 * the marker is drawn, or the marker is drawn at full size and then shrunk with
 * everything else, which is fine, whereas the reverse would draw a marker sized
 * for a picture that no longer exists.
 */
function toJpegFrom(data, { maxWidth = 1600, quality = 80 } = {}) {
  try {
    return encode(nativeImage.createFromBuffer(data), maxWidth, quality);
  } catch {
    return null;
  }
}

module.exports = { toJpeg, toJpegFrom };
