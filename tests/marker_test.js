/**
 * The click indicator. The property that matters: the thing it points at is the
 * point that was clicked, and the marker stays inside the picture - an arrow
 * whose tail runs off the top of the image points at nothing.
 */
const m = require('../ui/src/renderer/marker');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const middle = { x: 50, y: 50 };

console.log('the circle:');
{
  const p = m.plan(middle, { style: 'circle' });
  check('is centred on the click', p.offsetX === p.size / 2 && p.offsetY === p.size / 2);
  const bold = m.plan(middle, { style: 'circle', bold: true });
  check('gets bigger when bold', bold.size > p.size);
  check('and thicker', bold.stroke > p.stroke);
  check('still centred when bold',
        bold.offsetX === bold.size / 2 && bold.offsetY === bold.size / 2);
}

console.log('\nthe arrow points at the click, not near it:');
{
  const p = m.plan(middle, { style: 'arrow' });
  // The element is offset so that its tip lands exactly on the point.
  check('its tip is the anchored corner', p.tipX === p.offsetX && p.tipY === p.offsetY);
  check('and its tail is the opposite corner',
        (p.size - p.tipX) !== p.tipX || p.size === 0);
  check('by default it comes from up-left', p.dx === 1 && p.dy === 1);
}

console.log('\nand stays inside the picture:');
{
  const topLeft = m.plan({ x: 4, y: 3 }, { style: 'arrow' });
  check('a click in the top-left corner flips both ways',
        topLeft.dx === -1 && topLeft.dy === -1);
  check('so its tip is the top-left corner of the element',
        topLeft.tipX === 0 && topLeft.tipY === 0);

  const topRight = m.plan({ x: 96, y: 3 }, { style: 'arrow' });
  check('a click at the top edge flips vertically only',
        topRight.dx === 1 && topRight.dy === -1);

  const bottomLeft = m.plan({ x: 2, y: 90 }, { style: 'arrow' });
  check('a click at the left edge flips horizontally only',
        bottomLeft.dx === -1 && bottomLeft.dy === 1);

  check('a bold arrow is longer', m.plan(middle, { style: 'arrow', bold: true }).size
        > m.plan(middle, { style: 'arrow' }).size);
}

console.log('\nthe markup:');
{
  const circle = m.html(middle, { style: 'circle' });
  check('a circle needs no svg', !circle.includes('<svg'));
  check('and is positioned as a percentage', circle.includes('left:50.00%'));

  const arrow = m.html({ x: 25.5, y: 60 }, { style: 'arrow' });
  check('an arrow draws one', arrow.includes('<svg'));
  check('positioned as a percentage too', arrow.includes('left:25.50%'));
  check('with a halo behind it for contrast', arrow.includes('rgba(255,255,255'));
  check('and the marker colour on top', arrow.includes('#e5484d'));

  check('bold is marked on the circle',
        m.html(middle, { style: 'circle', bold: true }).includes('bsr-bold'));
  check('an unknown style falls back to the circle',
        !m.html(middle, { style: 'wat' }).includes('<svg'));
}

console.log('\nthe arrowhead is a triangle, not a line:');
{
  // The first version offset both barbs along the shaft's own diagonal instead
  // of perpendicular to it, so all three points were collinear and the head
  // collapsed. Nothing in the markup looked wrong; only the picture did, and
  // every string-matching check above passed straight through it.
  for (const pos of [{ x: 50, y: 50 }, { x: 5, y: 5 }, { x: 95, y: 5 }, { x: 5, y: 95 }]) {
    const p = m.plan(pos, { style: 'arrow' });
    const svg = m.arrowSvg(p, '#000');

    // The head is the path with two line segments; the shaft has one.
    const head = svg.split('<path d="')
      .find((d) => (d.match(/ L /g) || []).length === 2);
    const n = head.match(/-?\d+(?:\.\d+)?/g).slice(0, 6).map(Number);
    const area = Math.abs((n[2] - n[0]) * (n[5] - n[1]) - (n[4] - n[0]) * (n[3] - n[1])) / 2;

    check(`head at ${pos.x},${pos.y} encloses real area (${area.toFixed(0)}px)`,
          area > 20);
  }
}

console.log('\none source, two applications:');
{
  // The window runs under style-src 'self', which refuses both an injected
  // <style> element and a style="..." attribute. So the DECLARATIONS are the
  // shared thing and each side applies them its own way. Written as a
  // stylesheet this was inert in the preview and perfect in the export -
  // exactly the disagreement this module exists to prevent.
  const { declarations: d } = m.declarations({ x: 40, y: 70 }, { style: 'circle' });
  check('positions in percentages', d.left === '40.00%' && d.top === '70.00%');
  check('never swallows clicks', d.pointerEvents === 'none');
  check('a circle carries its own border', String(d.border).includes('solid'));
  check('and is sized by its box, not its content', d.boxSizing === 'border-box');

  const bold = m.declarations({ x: 40, y: 70 }, { style: 'circle', bold: true }).declarations;
  check('bold is a thicker border', bold.border !== d.border);

  const arrow = m.declarations({ x: 40, y: 70 }, { style: 'arrow' }).declarations;
  check('an arrow needs no border of its own', arrow.border === undefined);

  const inline = m.toCss(d);
  check('serialises to hyphenated css', inline.includes('pointer-events:none'));
  check('and carries the position', inline.includes('left:40.00%'));

  // The export ships no stylesheet, so its markup must carry everything.
  const markup = m.html({ x: 40, y: 70 }, { style: 'circle' });
  check('the exported markup is self-contained',
        markup.includes('position:absolute') && markup.includes('border-radius:50%'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
