/**
 * Cropping a screenshot.
 *
 * The property that matters is not the pixels — it is that the click marker
 * still points at the thing it pointed at. The marker is a percentage of the
 * step's `frame`, so cutting the image without cutting the frame by the same
 * proportion moves it, on every export, with nothing to show that it happened.
 */
const c = require('../ui/src/renderer/crop');
const { markerPosition } = require('../ui/src/main/export');

let pass = 0, fail = 0;
const check = (n, ok) => { ok ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };
const near = (a, b, tol = 0.001) => Math.abs(a - b) < tol;

const image = { width: 800, height: 600 };
// A window at (100, 50) on the desktop, 800x600 of it captured.
const frame = { x: 100, y: 50, w: 800, h: 600 };

console.log('a crop stays inside the picture:');
{
  check('a negative origin is pulled in', c.clamp({ x: -20, y: -5, w: 100, h: 100 }, image).x === 0);
  check('and so is an oversized width',
        c.clamp({ x: 700, y: 0, w: 400, h: 100 }, image).w === 100);
  check('fractions become whole pixels',
        c.clamp({ x: 10.6, y: 10.2, w: 50.5, h: 50.4 }, image).x === 11);
  check('and it is never empty',
        c.clamp({ x: 0, y: 0, w: 0, h: 0 }, image).w >= 1);
}

console.log('\nwhat counts as a crop somebody meant:');
{
  check('a stray click does not blank a screenshot',
        !c.isDeliberate({ x: 10, y: 10, w: 4, h: 4 }, image));
  check('a real region does', c.isDeliberate({ x: 10, y: 10, w: 300, h: 200 }, image));
  // Refused rather than performed: it would cost an undo slot and a re-encode
  // to produce the picture that is already there.
  check('cropping to the whole picture is not a crop',
        !c.isDeliberate({ x: 0, y: 0, w: 800, h: 600 }, image));
  check('but trimming one edge is',
        c.isDeliberate({ x: 0, y: 0, w: 800, h: 400 }, image));
}

console.log('\nthe frame is cut by the same proportion as the picture:');
{
  // The right half of the image is the right half of the frame.
  const f = c.frameAfter(frame, { x: 400, y: 0, w: 400, h: 600 }, image);
  check('the origin moves by the crop', near(f.x, 500) && near(f.y, 50));
  check('and the size shrinks with it', near(f.w, 400) && near(f.h, 600));

  // A frame in different units from the image - a 4K capture of a window
  // measured in logical pixels - must scale, not offset.
  const scaled = c.frameAfter({ x: 0, y: 0, w: 1920, h: 1080 },
                              { x: 960, y: 0, w: 960, h: 1080 },
                              { width: 3840, height: 2160 });
  check('a frame in other units scales rather than shifting',
        near(scaled.x, 480) && near(scaled.w, 480));

  check('a step with no frame says so rather than inventing one',
        c.frameAfter(null, { x: 0, y: 0, w: 10, h: 10 }, image) === null);
  check('and so does one with a zero-sized frame',
        c.frameAfter({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0, w: 10, h: 10 }, image) === null);
}

console.log('\nthe click still points at what it pointed at:');
{
  // The click at desktop (500, 350) is dead centre of the original frame.
  const point = { x: 500, y: 350 };
  const before = markerPosition({ point, frame });
  check('centred before the crop', near(before.x, 50, 0.01) && near(before.y, 50, 0.01));

  // Crop to the middle quarter. The click is still in it, and still central.
  const crop = { x: 200, y: 150, w: 400, h: 300 };
  const after = c.markerAfter(point, frame, crop, image);
  check('still centred after it', near(after.x, 50, 0.01) && near(after.y, 50, 0.01));

  // The check that would have caught the naive version: cropping WITHOUT
  // moving the frame leaves the marker where it was, which is now wrong.
  const naive = markerPosition({ point, frame });
  check('and the naive answer really would have differed',
        Math.abs(naive.x - 50) < 0.01
        && Math.abs(c.markerAfter(point, frame, { x: 0, y: 0, w: 400, h: 300 }, image).x - 100)
           < 0.01);

  // The whole point of keeping the two in step: the exporter's own function,
  // given the updated frame, must agree with this module.
  const next = c.frameAfter(frame, crop, image);
  const viaExport = markerPosition({ point, frame: next });
  check('the exporter agrees with the crop',
        near(viaExport.x, after.x, 0.001) && near(viaExport.y, after.y, 0.001));
}

console.log('\nwhen the crop cuts the click out:');
{
  const point = { x: 500, y: 350 };
  const away = { x: 0, y: 0, w: 100, h: 100 };

  check('there is no marker to place',
        c.markerAfter(point, frame, away, image) === null);
  check('and it can be asked about before the crop is made',
        c.losesMarker(point, frame, away, image));
  check('a crop that keeps the click does not warn',
        !c.losesMarker(point, frame, { x: 200, y: 150, w: 400, h: 300 }, image));
  check('a step with no click cannot lose one',
        !c.losesMarker(null, frame, away, image));
  check('and neither can one with no frame',
        !c.losesMarker(point, null, away, image));
}


console.log('\na marker the author dragged is cut with the picture:');
{
  // A recorded marker survives a crop because it is derived from the click and
  // the frame, and the frame is cut to match. A dragged one is a percentage of
  // the picture itself - so before this, cropping moved the content out from
  // under it and left it pointing at whatever slid into that percentage.
  const image = { width: 1000, height: 800 };
  const rect = { x: 250, y: 200, w: 500, h: 400 };   // keep the middle

  // 25%,25% of the old picture is pixel 250,200 - exactly the new corner.
  const moved = c.markerAtAfter({ x: 25, y: 25 }, rect, image);
  check('a marker on the new top-left corner reads as 0%',
        moved !== null && Math.abs(moved.x) < 0.001 && Math.abs(moved.y) < 0.001,
        JSON.stringify(moved));

  const middle = c.markerAtAfter({ x: 50, y: 50 }, rect, image);
  check('the centre of a centred crop stays the centre',
        middle !== null && Math.abs(middle.x - 50) < 0.001
                        && Math.abs(middle.y - 50) < 0.001);

  check('a marker outside the region is cut away, not clamped',
        c.markerAtAfter({ x: 5, y: 5 }, rect, image) === null);
  check('and so is one past the far edge',
        c.markerAtAfter({ x: 99, y: 99 }, rect, image) === null);
  check('nothing to move is not an error',
        c.markerAtAfter(null, rect, image) === null);
  check('and neither is a marker with no numbers in it',
        c.markerAtAfter({ x: 'a', y: 2 }, rect, image) === null);

  // Cropping the whole picture changes nothing.
  const whole = c.markerAtAfter({ x: 30, y: 70 },
                                   { x: 0, y: 0, w: 1000, h: 800 }, image);
  check('a crop that keeps everything moves nothing',
        whole !== null && Math.abs(whole.x - 30) < 0.001
                       && Math.abs(whole.y - 70) < 0.001);

  // ---- which marker the warning is about ---------------------------------
  const frame = { x: 0, y: 0, w: 1000, h: 800 };
  const clicked = { point: { x: 500, y: 400 }, frame };            // dead centre
  const dragged = { point: { x: 500, y: 400 }, frame, markerAt: { x: 5, y: 5 } };

  check('a crop that keeps the click does not warn about it',
        c.losesAnyMarker(clicked, rect, image) === false);
  // The click is still inside; the marker the reader will see is not.
  check('but it warns when the DRAGGED marker is the one being cut away',
        c.losesAnyMarker(dragged, rect, image) === true);

  // A photograph: no click, no frame, only a marker somebody placed.
  const photo = { markerAt: { x: 50, y: 50 } };
  check('a photograph keeps its marker when the crop contains it',
        c.losesAnyMarker(photo, rect, image) === false);
  check('and loses it when the crop does not',
        c.losesAnyMarker({ markerAt: { x: 2, y: 2 } }, rect, image) === true);
  check('a picture with no marker at all cannot lose one',
        c.losesAnyMarker({}, rect, image) === false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
