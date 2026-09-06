/**
 * A real PNG of a given size, for tests that need an image with honest
 * dimensions rather than a 1x1 placeholder.
 *
 * Several things in this application are arithmetic between a displayed
 * element and an image's natural size — the drag-to-image ratio, the click
 * marker's percentage, a crop rectangle. A 1x1 stand-in makes every one of
 * those ratios degenerate, so a test using one can pass while the real maths
 * is wrong.
 *
 * Written by hand rather than pulling in an encoder: a solid colour is four
 * chunks and a CRC, and a test fixture should not add a dependency to the
 * project it is testing.
 */
const zlib = require('node:zlib');

const CRC = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
})();

function chunk(type, data) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(CRC(body));
  return Buffer.concat([head, body, crc]);
}

/**
 * A solid-colour PNG, `width` by `height`.
 *
 * Colour type 2 (truecolour, 8 bits) rather than a palette, so the bytes are
 * laid out the obvious way and a test that reads a pixel back can find it.
 */
function solidPng(width, height, [r, g, b] = [90, 96, 110]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  // 10..12: compression, filter, interlace - all zero, all the only option.

  // Each scanline is a filter byte followed by RGB triples.
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = r;
    row[2 + x * 3] = g;
    row[3 + x * 3] = b;
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row));

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const solidPngDataUrl = (w, h, rgb) =>
  'data:image/png;base64,' + solidPng(w, h, rgb).toString('base64');

module.exports = { solidPng, solidPngDataUrl };
