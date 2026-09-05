/**
 * Window fitting. The property that matters most: the window never ends up
 * taller than the work area, because the edge that goes off-screen is the
 * bottom one, and the bottom of this interface is the status bar.
 */
const b = require('../ui/src/main/bounds');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

// A 1920x1080 monitor at 125% scaling, in the points Electron reports.
const PRIMARY = { x: 0, y: 0, width: 1536, height: 816 };
// The same monitor placed to its right, as a second display.
const SECOND = { x: 1536, y: 0, width: 1536, height: 816 };
// A 1366x768 laptop at 125% - shorter than the 600 point minimum.
const SMALL = { x: 0, y: 0, width: 1092, height: 566 };

const MIN = { width: 940, height: 600 };
const inside = (r, wa) => r.x >= wa.x && r.y >= wa.y
  && r.x + r.width <= wa.x + wa.width && r.y + r.height <= wa.y + wa.height;

console.log('a window that already fits:');
{
  const start = { x: 137, y: 56, width: 1265, height: 708 };
  const r = b.fit(start, PRIMARY, MIN);
  check('is left exactly alone', !b.differs(start, r));
  check('and reports no change', JSON.stringify([r.x, r.y, r.width, r.height])
        === JSON.stringify([137, 56, 1265, 708]));
}

console.log('\na window taller than the work area:');
{
  const r = b.fit({ x: 0, y: 0, width: 1200, height: 1000 }, PRIMARY, MIN);
  check('is shortened to the work area', r.height === 816);
  check('and its bottom is on screen', r.y + r.height <= PRIMARY.height);
  check('width is untouched', r.width === 1200);
}

console.log('\na window hanging off the bottom:');
{
  const r = b.fit({ x: 100, y: 700, width: 1000, height: 700 }, PRIMARY, MIN);
  check('is moved up rather than resized', r.height === 700 && r.y === 116);
  check('and now fits entirely', inside(r, PRIMARY));
}

console.log('\non a second display:');
{
  const start = { x: 1620, y: 40, width: 1265, height: 708 };
  const r = b.fit(start, SECOND, MIN);
  check('a window that fits there is not dragged back to the primary',
        !b.differs(start, r));
  const off = b.fit({ x: 3000, y: 40, width: 1265, height: 708 }, SECOND, MIN);
  check('one hanging off its right edge is pulled back onto it',
        off.x === 1536 + 1536 - 1265);
  check('and stays on that display, not the primary', off.x >= SECOND.x);
}

console.log('\na monitor unplugged, leaving the window nowhere:');
{
  // The bounds were saved on the second display; only the primary remains.
  const r = b.fit({ x: 2400, y: 300, width: 1265, height: 708 }, PRIMARY, MIN);
  check('the window comes back onto the surviving display', inside(r, PRIMARY));
  check('at the far edge rather than off it', r.x === 1536 - 1265);
}

console.log('\na display too small for the minimum size:');
{
  const r = b.fit({ x: 0, y: 0, width: 940, height: 600 }, SMALL, MIN);
  check('the minimum height is given up, not the status bar',
        r.minHeight === 566 && r.height === 566);
  check('the window fits the laptop screen', inside(r, SMALL));
  check('the minimum width is relaxed too when needed',
        b.fit({ x: 0, y: 0, width: 940, height: 400 },
              { x: 0, y: 0, width: 800, height: 600 }, MIN).minWidth === 800);
  check('but a display with room keeps the real minimum',
        b.fit({ x: 0, y: 0, width: 940, height: 600 }, PRIMARY, MIN).minHeight === 600);
}

console.log('\nthe minimum is a floor, not just a label:');
{
  // Something has shrunk the window below what the editor is usable at.
  const r = b.fit({ x: 0, y: 0, width: 400, height: 300 }, PRIMARY, MIN);
  check('an undersized window is grown back to the minimum',
        r.width === 940 && r.height === 600);
}

console.log('\ncalled with no minimum at all:');
{
  const r = b.fit({ x: 0, y: 0, width: 300, height: 120 }, PRIMARY);
  check('nothing is forced', r.width === 300 && r.height === 120);
  check('which is what the compact strip needs', r.minWidth === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
