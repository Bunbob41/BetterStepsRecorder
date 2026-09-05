/**
 * Fitting screenshots into a document. The property that matters most: an
 * export never attempts a string longer than JavaScript can hold, because the
 * failure is total - "Invalid string length", and no file written at all.
 */
const s = require('../ui/src/main/screenshots');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const MB = 1024 * 1024;

// A recording of application windows: PNG is right and small.
const ordinary = Array.from({ length: 40 }, (_, i) => `/shots/${i}.png`);
const ordinarySize = () => 180 * 1024;

// The Rocket League recording that started this: 106 frames, 412MB.
const heavy = Array.from({ length: 106 }, (_, i) => `/game/${i}.png`);
const heavySize = () => 4.08 * MB;

// Stands in for the JPEG encoder, at a realistic ratio for a 3D frame.
const shrink = (ratio) => (f) => ({
  data: Buffer.alloc(Math.round(heavySize(f) * ratio)),
  mime: 'image/jpeg',
  ext: '.jpg',
});

console.log('the limit itself:');
check('512MB of base64 is refused', !s.canEmbed(520 * MB));
check('the real failing case is refused', !s.canEmbed(412 * MB));
check('a modest recording is fine', s.canEmbed(20 * MB));
check('headroom is left for the markup',
      !s.canEmbed(Math.floor(s.MAX_STRING * 3 / 4)));

console.log('\na recording of ordinary windows:');
{
  const p = s.prepare(ordinary, { sizeOf: ordinarySize, transcode: shrink(0.06) });
  check('is left as PNG', p.mode === 'original');
  check('nothing is re-encoded', p.images === null);
  check('and the user is told nothing, because nothing happened',
        s.describe(p) === null);
  check('it embeds', s.canEmbed(p.after));
}

console.log('\nthe 412MB recording:');
{
  const p = s.prepare(heavy, { sizeOf: heavySize, transcode: shrink(0.06) });
  check('is re-encoded', p.mode === 'transcoded');
  check('before is the real total', Math.round(p.before / MB) === 432);
  check('after is far smaller', p.after < 40 * MB);
  check('and now it embeds', s.canEmbed(p.after));
  check('the user is told what happened', /re-encoded/.test(s.describe(p)));
  check('with both sizes named', /432MB to 2[0-9]MB/.test(s.describe(p)));
}

console.log('\nwhen re-encoding is not enough:');
{
  // Thousands of frames: even at JPEG sizes this cannot be one string.
  const many = Array.from({ length: 4000 }, (_, i) => `/long/${i}.png`);
  const p = s.prepare(many, { sizeOf: heavySize, transcode: shrink(0.06) });
  check('it still re-encodes', p.mode === 'transcoded');
  check('but refuses to embed, rather than throwing', !s.canEmbed(p.after));
}

console.log('\nwhen a screenshot cannot be read:');
{
  const p = s.prepare(heavy, {
    sizeOf: heavySize,
    // Every third file fails to decode.
    transcode: (f) => (Number(f.match(/(\d+)/)[1]) % 3 === 0 ? null : shrink(0.06)(f)),
  });
  check('the export is not abandoned', p.mode === 'transcoded');
  // 36 of the 106 keep their full 4.08MB; the other 70 shrink to about 6%.
  check('unreadable ones keep their original size',
        Math.round(p.after / MB) === 164);
  check('and are simply absent from the re-encoded set',
        !p.images.has('/game/0.png') && p.images.has('/game/1.png'));
}

console.log('\nwith no encoder available:');
{
  const p = s.prepare(heavy, { sizeOf: heavySize });
  check('nothing is claimed to have changed', p.mode === 'original');
  check('and the caller can see it will not embed', !s.canEmbed(p.after));
}

console.log('\nadvising on a recording that is paying for PNG:');
{
  const game = s.advise({ files: heavy, sizeOf: heavySize, format: 'png' });
  check('a recording of 3D frames is flagged', game !== null);
  check('the total is named', /432MB/.test(game.message));
  check('and the cost per screenshot', /4\.1MB per screenshot/.test(game.message));
  check('it points at the setting', /Settings/.test(game.message));
}

console.log('\nand staying quiet otherwise:');
{
  check('nothing is said when already on JPEG',
        s.advise({ files: heavy, sizeOf: heavySize, format: 'jpg' }) === null);

  // The point of judging on the average rather than the total: a long recording
  // of ordinary windows is large without anything being wrong.
  const long = Array.from({ length: 900 }, (_, i) => `/app/${i}.png`);
  check('a long recording of ordinary windows is not flagged',
        s.advise({ files: long, sizeOf: () => 150 * 1024, format: 'png' }) === null);

  // A 4K screenshot of a text-heavy window is large, but nothing like 2MB.
  check('a 4K text screenshot is not mistaken for video',
        s.advise({ files: long, sizeOf: () => 1.1 * MB, format: 'png' }) === null);

  check('a handful of frames is too small a sample to judge',
        s.advise({ files: heavy.slice(0, 3), sizeOf: heavySize,
                   format: 'png' }) === null);

  check('and a short recording stays under the total floor',
        s.advise({ files: heavy.slice(0, 10), sizeOf: () => 2.5 * MB,
                   format: 'png' }) === null);

  check('an empty recording says nothing', s.advise({ files: [] }) === null);
  check('called with nothing at all, it does not throw', s.advise() === null);
}

console.log('\ntotals:');
check('an empty recording is zero, not NaN', s.totalBytes([]) === 0);
check('a missing file counts as nothing rather than throwing',
      s.totalBytes(['/does/not/exist.png']) === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
