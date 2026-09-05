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
function toJpeg(file, { maxWidth = 1600, quality = 80 } = {}) {
  try {
    let img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;

    // Downscale only. A screenshot narrower than this is already reasonable,
    // and enlarging it would add bytes without adding detail.
    if (img.getSize().width > maxWidth) {
      img = img.resize({ width: maxWidth, quality: 'good' });
    }

    const data = img.toJPEG(quality);
    return data && data.length ? { data, mime: 'image/jpeg', ext: '.jpg' } : null;
  } catch {
    // An unreadable screenshot must not cost the user the whole export.
    return null;
  }
}

module.exports = { toJpeg };
