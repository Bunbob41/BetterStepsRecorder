/**
 * Trimming a screenshot down to the part that matters.
 *
 * A screenshot framed by the monitor, or of a maximised window, is mostly not
 * the thing being pointed at. Cropping is the difference between a guide whose
 * pictures a reader can follow and one where every step is a full desktop with
 * a small ring somewhere in it.
 *
 * The awkward part is not the pixels. Every step records the `frame` it was
 * captured from, and the click marker is stored as a PERCENTAGE of that frame -
 * so cutting the image without touching the frame moves the marker off the
 * thing it points at, on every export, silently. The frame has to be cut by the
 * same proportion as the picture, and then the percentage still resolves to the
 * same place in the world.
 *
 * That is what this module is: the arithmetic, separated so it can be checked
 * without a canvas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrCrop = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /** The smallest crop worth making, in image pixels. */
  const MINIMUM = 24;

  /** Whole numbers, inside the picture, and never zero-sized. */
  function clamp(crop, image) {
    const iw = Math.max(1, Math.round(image.width));
    const ih = Math.max(1, Math.round(image.height));

    let x = Math.round(Math.max(0, Math.min(crop.x, iw)));
    let y = Math.round(Math.max(0, Math.min(crop.y, ih)));
    let w = Math.round(Math.max(1, Math.min(crop.w, iw - x)));
    let h = Math.round(Math.max(1, Math.min(crop.h, ih - y)));

    // A drag that started outside can leave nothing; pull it back in rather
    // than producing an empty picture.
    if (x + w > iw) x = Math.max(0, iw - w);
    if (y + h > ih) y = Math.max(0, ih - h);

    return { x, y, w, h };
  }

  /**
   * Whether this is a crop somebody meant.
   *
   * A stray click must not blank a screenshot, and a drag that covers the whole
   * picture is a no-op worth refusing: it would still cost an undo slot and a
   * re-encode for nothing.
   */
  function isDeliberate(crop, image) {
    const c = clamp(crop, image);
    if (c.w < MINIMUM || c.h < MINIMUM) return false;
    const iw = Math.max(1, Math.round(image.width));
    const ih = Math.max(1, Math.round(image.height));
    return c.w < iw || c.h < ih;
  }

  /**
   * The frame this step should now record.
   *
   * Cut by the same proportion as the picture, in the frame's own coordinates -
   * which are the virtual desktop's, not the image's. Doing this is what keeps
   * the click marker on the thing it points at: it is a percentage of the
   * frame, so the frame has to shrink with the image or the percentage starts
   * meaning somewhere else.
   *
   * Returns null when there is no frame to cut, which is the honest answer -
   * the caller should then leave the step's frame alone.
   */
  function frameAfter(frame, crop, image) {
    if (!frame || !frame.w || !frame.h) return null;
    const c = clamp(crop, image);
    const iw = Math.max(1, Math.round(image.width));
    const ih = Math.max(1, Math.round(image.height));

    const sx = frame.w / iw;
    const sy = frame.h / ih;

    return {
      x: frame.x + c.x * sx,
      y: frame.y + c.y * sy,
      w: c.w * sx,
      h: c.h * sy,
    };
  }

  /**
   * Where the click sits inside the cropped picture, as a percentage, or null
   * when it fell outside and there is nothing left to point at.
   *
   * The same arithmetic the exporters use, here so a crop can be judged before
   * it is made rather than discovered in a document.
   */
  function markerAfter(point, frame, crop, image) {
    const next = frameAfter(frame, crop, image);
    if (!next || !point) return null;
    const x = ((point.x - next.x) / next.w) * 100;
    const y = ((point.y - next.y) / next.h) * 100;
    if (x < 0 || y < 0 || x > 100 || y > 100) return null;
    return { x, y };
  }

  /** Whether this crop would cut the click out of the picture. */
  const losesMarker = (point, frame, crop, image) =>
    Boolean(point) && Boolean(frame && frame.w)
    && markerAfter(point, frame, crop, image) === null;

  return { MINIMUM, clamp, isDeliberate, frameAfter, markerAfter, losesMarker };
}));
