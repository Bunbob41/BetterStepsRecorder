/**
 * Saying how much room something takes, to a person.
 *
 * Screenshots stack up faster than anybody expects - a recording of an
 * ordinary afternoon runs to tens of megabytes, and a recording of anything
 * animated runs to hundreds. Somebody who cannot see that only finds out when
 * a disk fills, which is the worst possible moment to learn it.
 *
 * One decimal place below 10, none above: "9.4 MB" is worth the character and
 * "412.7 MB" is not, and a column of sizes reads better when the numbers are
 * about the same width.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrBytes = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

  /** 1024, not 1000: this is what Windows itself shows for a folder. */
  const STEP = 1024;

  function human(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '0 B';

    let value = n;
    let unit = 0;
    while (value >= STEP && unit < UNITS.length - 1) {
      value /= STEP;
      unit++;
    }

    // Bytes are never fractional, and neither is anything that rounds to a
    // whole number of them.
    if (unit === 0) return `${Math.round(value)} B`;

    // A tenth is worth a character below ten and noise above it.
    const shown = value < 10 ? value.toFixed(1) : String(Math.round(value));
    // 9.95 MB rounds to "10.0", which should have been the next bracket.
    if (unit < UNITS.length - 1 && Number(shown) >= STEP) {
      return `1.0 ${UNITS[unit + 1]}`;
    }
    return `${shown} ${UNITS[unit]}`;
  }

  return { human, UNITS };
}));
