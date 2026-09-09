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
  check('and its tail is somewhere else entirely',
        p.tailX !== p.tipX && p.tailY !== p.tipY);
  // Stated as where the tail actually is rather than as the sign of a vector:
  // the arrow used to be able to point along four diagonals and nothing else,
  // and an assertion about dx === 1 was really about that limitation.
  check('by default it comes from up-left',
        p.tailX < p.tipX && p.tailY < p.tipY);
}

console.log('\nand stays inside the picture:');
{
  const topLeft = m.plan({ x: 4, y: 3 }, { style: 'arrow' });
  check('a click in the top-left corner is pointed at from below right',
        topLeft.tailX > topLeft.tipX && topLeft.tailY > topLeft.tipY);
  check('so its tip is at the near end of the element',
        topLeft.tipX < topLeft.w / 2 && topLeft.tipY < topLeft.h / 2);

  const topRight = m.plan({ x: 96, y: 3 }, { style: 'arrow' });
  check('a click at the top edge is pointed at from below left',
        topRight.tailX < topRight.tipX && topRight.tailY > topRight.tipY);

  const bottomLeft = m.plan({ x: 2, y: 90 }, { style: 'arrow' });
  check('a click at the left edge is pointed at from above right',
        bottomLeft.tailX > bottomLeft.tipX && bottomLeft.tailY < bottomLeft.tipY);

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

console.log('\nis there a marker at all, and where:');
{
  // One answer for the window, the exporters and the burn-in. It used to be
  // written twice and stood in for three times more by asking "does this step
  // have a click point?" - which is wrong in both directions: a step can have
  // a click and show no marker, and show a marker with no click.
  const frame = { x: 0, y: 0, w: 1000, h: 800 };
  const clicked = { point: { x: 250, y: 200 }, frame };

  const at = m.positionFor(clicked);
  check('a recorded click is a quarter across and a quarter down',
        at && Math.abs(at.x - 25) < 0.001 && Math.abs(at.y - 25) < 0.001);
  check('and is not reported as moved', at && at.moved === false);

  const dragged = m.positionFor({ ...clicked, markerAt: { x: 70, y: 10 } });
  check('a dragged position wins over the recorded one',
        dragged && dragged.x === 70 && dragged.y === 10);
  check('and says so, which is how the window marks it',
        dragged && dragged.moved === true);

  // ---- turned off, two ways ----------------------------------------------
  check('hidden on the step means no marker',
        m.positionFor({ ...clicked, markerHidden: true }) === null);
  check('and it stays hidden even though the click is still recorded',
        m.positionFor({ ...clicked, markerHidden: true, markerAt: { x: 5, y: 5 } })
          === null);
  check('turned off everywhere means no marker',
        m.positionFor(clicked, { show: false }) === null);
  check('and absent options mean shown, so nothing changes for anyone',
        m.positionFor(clicked, {}) !== null && m.positionFor(clicked) !== null);
  check('only false turns it off, not any falsey thing',
        m.positionFor(clicked, { show: undefined }) !== null);

  // ---- a picture with no click -------------------------------------------
  // A photograph has no click point, no window and no frame. It can still
  // carry a marker somebody placed on it.
  check('a picture with a placed marker has one',
        JSON.stringify(m.positionFor({ markerAt: { x: 40, y: 60 } }))
          === JSON.stringify({ x: 40, y: 60, moved: true }));
  check('a picture with nothing placed has none',
        m.positionFor({ screenshot: 'photo.jpg' }) === null);
  check('a written step has none', m.positionFor({ action: 'note' }) === null);
  check('and nothing at all is not an error', m.positionFor(null) === null);

  // ---- a click outside its own frame -------------------------------------
  check('a click outside the captured frame is not marked',
        m.positionFor({ point: { x: 5000, y: 5000 }, frame }) === null);
}

console.log('\nan arrow can be pointed anywhere, not just along a diagonal:');
{
  const at = { x: 50, y: 50 };
  const tip = (a) => m.plan(at, { style: 'arrow', angle: a });

  // Screen coordinates: y runs down, so 90 degrees comes from above.
  const right = tip(0);
  check('at 0 degrees the tail is directly left of the tip',
        right.tailX < right.tipX
        && Math.abs(right.tailY - right.tipY) < 0.001);
  const down = tip(90);
  check('at 90 it is directly above',
        down.tailY < down.tipY && Math.abs(down.tailX - down.tipX) < 0.001);
  const left = tip(180);
  check('at 180 it is directly right',
        left.tailX > left.tipX && Math.abs(left.tailY - left.tipY) < 0.001);
  const up = tip(270);
  check('at 270 it is directly below',
        up.tailY > up.tipY && Math.abs(up.tailX - up.tipX) < 0.001);

  // A horizontal arrow in a square box would be clipped to a line by its own
  // bounding box, so the box is the shape of the arrow plus room for the head.
  check('a horizontal arrow gets a wide, short box', right.w > right.h * 2);
  check('a vertical one gets a tall, narrow box', down.h > down.w * 2);
  check('and neither is flat', right.h > 0 && down.w > 0);

  // The one property that must survive any angle.
  for (const a of [0, 37, 90, 145, 180, 233, 270, 315, -45]) {
    const p = tip(a);
    check(`at ${a} degrees the tip is still what the element is anchored by`,
          p.tipX === p.offsetX && p.tipY === p.offsetY);
  }

  check('the automatic angle is one of the four diagonals',
        [45, 135, -135, -45].includes(m.autoAngle({ x: 50, y: 50 }))
        && [45, 135, -135, -45].includes(m.autoAngle({ x: 4, y: 4 })));
  check('and a chosen angle overrides it',
        m.angleOf({ x: 50, y: 50 }, { angle: 12 }) === 12);
  check('while a nonsense one falls back rather than drawing nothing',
        m.angleOf({ x: 50, y: 50 }, { angle: 'sideways' }) === 45);

  // Rotating must not change how long the arrow looks.
  const lengths = [0, 45, 90, 200].map((a) => tip(a).length);
  check('every angle draws the same length',
        lengths.every((l) => Math.abs(l - lengths[0]) < 0.001));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
