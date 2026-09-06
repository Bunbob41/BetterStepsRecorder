/**
 * The marks an author adds to a screenshot. The properties that matter: an
 * arrow's head is a real triangle pointing where the drag ended, and a mark
 * stays the same visual weight on a small dialog and a 4K screenshot alike.
 */
const a = require('../ui/src/renderer/annotate');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

console.log('a mark is the same weight at any image size:');
{
  const dialog = a.strokeFor(420, 260);
  const laptop = a.strokeFor(1920, 1080);
  const uhd = a.strokeFor(3840, 2160);

  check('it grows with the image', dialog < laptop && laptop < uhd);
  check('it never vanishes on a small dialog', dialog >= 2);
  check('and never becomes a blob on a huge one', uhd <= 14);
  check('a 4K screenshot gets a heavier line than a small one', uhd > dialog);
}

console.log('\nthe arrowhead points where the drag ended:');
{
  const from = { x: 100, y: 100 };
  const to = { x: 300, y: 220 };
  const stroke = a.strokeFor(1920, 1080);
  const g = a.arrowGeometry(from, to, stroke);

  check('the head sits at the end of the drag',
        Math.abs(g.barbs[0].x - to.x) < g.head * 1.6
        && Math.abs(g.barbs[1].x - to.x) < g.head * 1.6);
  check('the shaft stops short of the point',
        Math.hypot(g.shaft.x - to.x, g.shaft.y - to.y) > 0);
  check('there are two barbs', g.barbs.length === 2);
  check('and they are on opposite sides of the shaft',
        (g.barbs[0].x - g.barbs[1].x) !== 0 || (g.barbs[0].y - g.barbs[1].y) !== 0);
}

console.log('\nand it is a triangle, not a line:');
{
  // The click marker's arrow shipped with all three points collinear, drawing
  // as a plain stroke with no point on it. Nothing in the code looked wrong.
  const stroke = a.strokeFor(1920, 1080);
  const drags = [
    ['right', { x: 10, y: 10 }, { x: 200, y: 10 }],
    ['down', { x: 10, y: 10 }, { x: 10, y: 200 }],
    ['diagonally', { x: 10, y: 10 }, { x: 200, y: 200 }],
    ['backwards', { x: 300, y: 300 }, { x: 60, y: 90 }],
    ['up-left', { x: 300, y: 300 }, { x: 100, y: 100 }],
  ];
  for (const [name, from, to] of drags) {
    const area = a.headArea(from, to, stroke);
    check(`dragged ${name}, the head encloses real area (${area.toFixed(0)}px)`, area > 10);
  }
}

console.log('\na very short arrow still has a head that fits:');
{
  const stroke = a.strokeFor(1920, 1080);
  const from = { x: 100, y: 100 };
  const to = { x: 118, y: 100 };
  const g = a.arrowGeometry(from, to, stroke);
  check('the head is never longer than the arrow', g.head <= g.length);
  check('and it still encloses area', a.headArea(from, to, stroke) > 0);
}

console.log('\nwhat counts as a deliberate drag:');
{
  const rect = (w, h) => ({ x: 0, y: 0, w, h });
  check('a stray click does not draw a box',
        !a.isDeliberate('box', rect(3, 3), { x: 0, y: 0 }, { x: 3, y: 3 }));
  check('a real drag does', a.isDeliberate('box', rect(40, 20), { x: 0, y: 0 }, { x: 40, y: 20 }));
  check('a twitch does not draw an arrow',
        !a.isDeliberate('arrow', rect(4, 4), { x: 0, y: 0 }, { x: 4, y: 4 }));
  check('a proper one does',
        a.isDeliberate('arrow', rect(2, 60), { x: 0, y: 0 }, { x: 2, y: 60 }));
  check('a thin horizontal arrow counts, though it is not a box',
        a.isDeliberate('arrow', rect(90, 1), { x: 0, y: 0 }, { x: 90, y: 1 }));
}

console.log('\nthe tools on offer:');
{
  check('box, arrow and highlight', a.TOOLS.join() === 'box,arrow,highlight');
  check('blur is not among them - it is a privacy act, not an annotation',
        !a.TOOLS.includes('blur'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
