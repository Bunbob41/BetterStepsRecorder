/**
 * Fitting a window to the display it is actually on.
 *
 * Kept as arithmetic on plain objects, with no reference to Electron, so the
 * awkward cases can be tested without a screen: a display shorter than the
 * window's own minimum size, a window straddling two monitors, a monitor
 * unplugged while the window was on it.
 *
 * The failure this exists to prevent is specific. If the window ends up taller
 * than the work area, the edge that goes off-screen is the bottom one, and the
 * bottom of this interface is the status bar. It disappears behind the taskbar,
 * where it can be neither read nor clicked, and the interface looks broken
 * rather than misplaced.
 */

/**
 * `bounds` and `workArea` are {x, y, width, height} in the same coordinate
 * space (for Electron, device-independent pixels). `minimum` is the smallest
 * size the window normally allows.
 *
 * Returns the corrected bounds plus the minimum size that should be in force,
 * which is not always the one that was asked for - see below.
 */
function fit(bounds, workArea, minimum = { width: 0, height: 0 }) {
  // A minimum size larger than the display is not a minimum, it is a promise
  // the screen cannot keep: Windows honours the minimum, so the window is
  // forced bigger than the work area and hangs off the bottom. On a 1366x768
  // laptop at 125% scaling there are about 566 usable points of height, and a
  // 600 point minimum is already too tall. Give up the minimum rather than the
  // status bar.
  const minWidth = Math.min(minimum.width || 0, workArea.width);
  const minHeight = Math.min(minimum.height || 0, workArea.height);

  const width = Math.max(minWidth, Math.min(bounds.width, workArea.width));
  const height = Math.max(minHeight, Math.min(bounds.height, workArea.height));

  // Slide, do not resize, to bring a window that is merely misplaced back on.
  const x = Math.min(Math.max(bounds.x, workArea.x),
                     workArea.x + workArea.width - width);
  const y = Math.min(Math.max(bounds.y, workArea.y),
                     workArea.y + workArea.height - height);

  return { x, y, width, height, minWidth, minHeight };
}

/** Whether `fit` would actually move or resize anything. */
function differs(bounds, fitted) {
  return bounds.x !== fitted.x || bounds.y !== fitted.y
      || bounds.width !== fitted.width || bounds.height !== fitted.height;
}

module.exports = { fit, differs };
