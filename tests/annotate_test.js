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

console.log('\nhighlighter colours:');
{
  check('there is more than one', a.HIGHLIGHTS.length >= 4);
  check('each has a name a legend could print',
        a.HIGHLIGHTS.every((h) => h.name && h.id));
  check('each is translucent, so what is marked still shows through',
        a.HIGHLIGHTS.every((h) => /rgba\([^)]+,\s*0\.\d+\)/.test(h.fill)));
  check('and none is opaque enough to obscure it',
        a.HIGHLIGHTS.every((h) => Number(h.fill.match(/([\d.]+)\)$/)[1]) <= 0.4));
  check('a known colour resolves', a.highlightFill('green') === a.HIGHLIGHTS[1].fill);
  check('an unknown one falls back rather than drawing nothing',
        a.highlightFill('chartreuse') === a.HIGHLIGHTS[0].fill);
  check('and so does none at all', a.highlightFill(undefined) === a.HIGHLIGHTS[0].fill);
}

console.log('\nthe key printed in a guide:');
{
  const step = (...ids) => ({ action: 'leftClick', highlights: ids });
  const meanings = { yellow: 'Check this', green: 'Safe to change' };

  const used = a.legendFor(
    [step('yellow'), step('green', 'yellow'), { action: 'leftClick' }], meanings);

  check('lists the colours the guide actually uses', used.length === 2);
  check('with what each means',
        used.find((h) => h.id === 'yellow').meaning === 'Check this');
  check('and a swatch to print', used.every((h) => h.fill));

  // Listing every colour would be a key to marks that are not there, and a
  // reader would hunt for an orange one that was never made.
  check('a colour never used is absent', !used.some((h) => h.id === 'orange'));

  // But a colour that IS used with nothing said about it must still appear:
  // a mark the key does not explain is what a key exists to prevent.
  const unexplained = a.legendFor([step('pink')], meanings);
  check('a used colour with no meaning is still listed', unexplained.length === 1);
  check('and says so rather than sitting blank', unexplained[0].meaning === '');

  check('no highlighting at all means no key',
        a.legendFor([{ action: 'leftClick' }], meanings).length === 0);
  check('and neither does an empty recording', a.legendFor([], meanings).length === 0);
  check('nor one that was never passed', a.legendFor(undefined, meanings).length === 0);

  // The order is the palette's, not the order they happened to be used, so two
  // guides from the same organisation read the same way.
  const order = a.legendFor([step('orange'), step('yellow')], {});
  check('listed in a consistent order', order[0].id === 'yellow');
}

console.log('\nthe tools on offer:');
{
  check('box, ellipse, arrow and highlight',
        a.TOOLS.join() === 'box,ellipse,arrow,highlight,text');
  check('blur is not among them - it is a privacy act, not an annotation',
        !a.TOOLS.includes('blur'));
}

console.log('\nmarks, held as data:');
{
  const box = { id: 'b1', tool: 'box', colour: 'blue',
                rect: { x: 25, y: 25, w: 50, h: 50 } };
  const svg = a.svgAll([box], 800, 600);

  // Percentages in, pixels out: 25% of 800 is 200, 25% of 600 is 150.
  check('a mark is drawn where its percentages say',
        svg.includes('x="200"') && svg.includes('y="150"'), svg.slice(0, 120));
  check('at the size its percentages say',
        svg.includes('width="400"') && svg.includes('height="300"'));
  check('in the colour it was given', svg.includes('#2f6fed'));
  check('over a pale outline, so it survives a light or dark screenshot',
        svg.includes('rgba(255,255,255,.85)'));
  check('carrying its id, so it can be found again',
        svg.includes('data-mark="b1"'));
  // Letterboxing an overlay would put every mark in the wrong PLACE, which is
  // worse than drawing one slightly wrong.
  check('stretched to the picture rather than fitted inside it',
        svg.includes('preserveAspectRatio="none"'));
  check('nothing at all when there are no marks', a.svgAll([], 800, 600) === '');

  const arrow = { id: 'a1', tool: 'arrow', colour: 'red',
                  from: { x: 10, y: 10 }, to: { x: 60, y: 40 } };
  const asvg = a.svgFor(arrow, 800, 600);
  check('an arrow is a shaft and a head', asvg.includes('<line')
        && asvg.includes('<polygon'));

  console.log('\nand found by where they are:');
  check('a click inside a box finds it', a.markAt([box], 50, 50) === box);
  check('a click outside finds nothing', a.markAt([box], 5, 5) === null);
  check('a click near an arrow finds it - a line cannot be hit exactly',
        a.markAt([arrow], 35, 25) === arrow);
  // The one on top is the one being looked at.
  const over = { ...box, id: 'b2' };
  check('the last one drawn wins where they overlap',
        a.markAt([box, over], 50, 50) === over);

  console.log('\nand text cannot write markup:');
  const nasty = { id: 't1', tool: 'text', colour: 'red', at: { x: 10, y: 10 },
                  text: '</text><script>alert(1)</script> & "quoted"' };
  const tsvg = a.svgFor(nasty, 800, 600);
  check('a closing tag in the text is escaped', !tsvg.includes('</text><script>'));
  check('an ampersand is escaped', tsvg.includes('&amp;'));
  check('and the words still come through', tsvg.includes('quoted'));

  console.log('\nthe size a mark is measured against:');
  check('a screenshot uses its captured frame',
        a.sizeOf({ frame: { x: 0, y: 0, w: 1920, h: 1080 } }).w === 1920);
  check('a photograph uses its recorded size',
        a.sizeOf({ size: { w: 2000, h: 1500 } }).h === 1500);
  check('and something with neither still gets a usable answer',
        a.sizeOf({}).w > 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
