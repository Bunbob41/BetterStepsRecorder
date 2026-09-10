/**
 * The marks a person adds to a screenshot: a box, an arrow, a highlight.
 *
 * A recorder can say where the click landed. It cannot say "this is the field
 * that matters" or "look here first" - that is the author's knowledge, and
 * without a way to add it every screenshot is a flat picture of a screen.
 *
 * Held as DATA on the step, not painted into the picture.
 *
 * They were painted in, once, and the reason was sound at the time: Word embeds
 * a screenshot and cannot layer anything over it, so a mark held as data would
 * have been missing from the format most likely to reach a company. The cost
 * was that a mark could never be undrawn - "delete this arrow" had no answer
 * except undo, in order, taking every later mark with it.
 *
 * That reason expired when `composite.js` was built to burn the CLICK marker
 * into the pixels for Word (D-31). The same machinery draws anything an SVG can
 * express into an image on the way out - so marks can be data everywhere, and
 * become pixels only in the formats that need them to be.
 *
 * Blur is NOT one of these and never will be: it is destructive on purpose,
 * because a redacted guide whose source image still holds the data is a lie.
 *
 * The geometry is separated from the drawing so the awkward parts - an arrow's
 * head, a stroke that stays visible at any image size - can be tested without a
 * canvas.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrAnnotate = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  // Blur is not here and never will be: it destroys pixels rather than adding
  // a mark to them, and nothing in this list can be deleted afterwards if it
  // is in that list.
  const TOOLS = ['box', 'ellipse', 'arrow', 'highlight', 'text'];

  /**
   * Highlighter colours. Named, because a colour used consistently through a
   * guide means something - and a reader can only be told what it means if it
   * has a name to be told about.
   */
  const HIGHLIGHTS = [
    { id: 'yellow', name: 'Yellow', fill: 'rgba(255, 224, 66, 0.32)' },
    { id: 'green', name: 'Green', fill: 'rgba(96, 230, 130, 0.30)' },
    { id: 'blue', name: 'Blue', fill: 'rgba(96, 176, 255, 0.32)' },
    { id: 'pink', name: 'Pink', fill: 'rgba(255, 122, 190, 0.30)' },
    { id: 'orange', name: 'Orange', fill: 'rgba(255, 158, 64, 0.32)' },
  ];

  const highlightFill = (id) =>
    (HIGHLIGHTS.find((h) => h.id === id) || HIGHLIGHTS[0]).fill;

  /**
   * Colours a mark can be drawn in.
   *
   * Named, and few. A palette of thirty is a colour picker; five is a decision
   * somebody can make in a second and still recognise on the next screenshot.
   * Red first because it is what every mark was until now, so nothing anybody
   * has already drawn changes appearance.
   */
  const COLOURS = [
    { id: 'red', name: 'Red', value: '#e5484d' },
    { id: 'blue', name: 'Blue', value: '#2f6fed' },
    { id: 'green', name: 'Green', value: '#1a9d52' },
    { id: 'amber', name: 'Amber', value: '#e08c00' },
    { id: 'black', name: 'Black', value: '#14181f' },
  ];

  const colourValue = (id) =>
    (COLOURS.find((c) => c.id === id) || COLOURS[0]).value;

  /**
   * How big lettering should be on an image of this size.
   *
   * The same argument as the stroke: fixed points are illegible on a 4K capture
   * and enormous on a dialog. Clamped, so a very small screenshot still gets
   * letters that fit and a very large one does not get a headline.
   */
  function fontFor(width, height, scale = 1) {
    const diagonal = Math.sqrt(width * width + height * height);
    const base = Math.max(13, Math.min(64, Math.round(diagonal / 46)));
    return Math.max(9, Math.round(base * (Number(scale) > 0 ? Number(scale) : 1)));
  }

  /**
   * The sizes a label can be.
   *
   * Three, not a number to type. A caption on a screenshot is either a note, a
   * label or a heading, and a person choosing between those three is making a
   * decision; a person choosing between 17 and 19 points is fiddling.
   */
  const SIZES = [
    { id: 'small', name: 'Small', scale: 0.7 },
    { id: 'medium', name: 'Medium', scale: 1 },
    { id: 'large', name: 'Large', scale: 1.6 },
  ];

  const sizeScale = (id) =>
    (SIZES.find((x) => x.id === id) || SIZES[1]).scale;

  const XML = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const escapeXml = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => XML[c]);

  /**
   * A mark's geometry in image pixels.
   *
   * Marks are stored as percentages of the picture, exactly like the click
   * marker and for the same reason: a step can be cropped, and a screenshot can
   * be re-encoded at a different size on its way into a document. Percentages
   * survive both; pixels survive neither.
   */
  function pixelsOf(mark, width, height) {
    const px = (v, span) => (Number(v) / 100) * span;
    if (mark.tool === 'arrow') {
      return {
        from: { x: px(mark.from.x, width), y: px(mark.from.y, height) },
        to: { x: px(mark.to.x, width), y: px(mark.to.y, height) },
      };
    }
    if (mark.tool === 'text') {
      return { at: { x: px(mark.at.x, width), y: px(mark.at.y, height) } };
    }
    return {
      rect: {
        x: px(mark.rect.x, width), y: px(mark.rect.y, height),
        w: px(mark.rect.w, width), h: px(mark.rect.h, height),
      },
    };
  }

  /**
   * One mark as SVG, in image pixels.
   *
   * Deliberately the same shapes `draw()` puts on a canvas - a pale outline
   * under a coloured stroke - because the two have to agree. What is on screen
   * IS what goes into the document; if these drifted, the guide would stop
   * matching the preview and there would be no way to see it here.
   */
  function svgFor(mark, width, height) {
    const stroke = strokeFor(width, height);
    const colour = colourValue(mark.colour);
    const p = pixelsOf(mark, width, height);
    const id = escapeXml(mark.id || '');
    const open = `<g data-mark="${id}" class="mark mark-${escapeXml(mark.tool)}">`;

    if (mark.tool === 'highlight') {
      const fill = highlightFill(mark.colour);
      return `${open}<rect x="${p.rect.x}" y="${p.rect.y}" `
           + `width="${p.rect.w}" height="${p.rect.h}" fill="${fill}"/></g>`;
    }

    if (mark.tool === 'text') {
      const size = fontFor(width, height, sizeScale(mark.size));
      // Painted stroke-then-fill, which is how the shapes get their pale
      // outline: lettering has to be readable on a white dialog and on a dark
      // terminal, and this is the one thing that works on both.
      return `${open}<text x="${p.at.x}" y="${p.at.y}" font-size="${size}" `
           + `font-family="Segoe UI, system-ui, sans-serif" font-weight="600" `
           + `paint-order="stroke" stroke="rgba(255,255,255,.9)" `
           + `stroke-width="${Math.max(3, Math.round(size / 6))}" `
           + `stroke-linejoin="round" fill="${colour}" `
           + `xml:space="preserve">${escapeXml(mark.text || '')}</text></g>`;
    }

    if (mark.tool === 'ellipse') {
      const cx = p.rect.x + p.rect.w / 2;
      const cy = p.rect.y + p.rect.h / 2;
      const rx = Math.abs(p.rect.w) / 2;
      const ry = Math.abs(p.rect.h) / 2;
      const ring = (c, w) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" `
                           + `fill="none" stroke="${c}" stroke-width="${w}"/>`;
      return open + ring('rgba(255,255,255,.85)', stroke + 4) + ring(colour, stroke) + '</g>';
    }

    if (mark.tool === 'box') {
      const box = (c, w) => `<rect x="${p.rect.x}" y="${p.rect.y}" `
                          + `width="${p.rect.w}" height="${p.rect.h}" fill="none" `
                          + `stroke="${c}" stroke-width="${w}" stroke-linejoin="round"/>`;
      return open + box('rgba(255,255,255,.85)', stroke + 4) + box(colour, stroke) + '</g>';
    }

    // arrow
    const g = arrowGeometry(p.from, p.to, stroke);
    const barbs = `${p.to.x},${p.to.y} ${g.barbs[0].x},${g.barbs[0].y} `
                + `${g.barbs[1].x},${g.barbs[1].y}`;
    const paint = (c, extra) =>
      `<line x1="${p.from.x}" y1="${p.from.y}" x2="${g.shaft.x}" y2="${g.shaft.y}" `
      + `stroke="${c}" stroke-width="${stroke + extra}" stroke-linecap="round"/>`
      + `<polygon points="${barbs}" fill="${c}" stroke="${c}" `
      + `stroke-width="${extra}" stroke-linejoin="round"/>`;
    return open + paint('rgba(255,255,255,.85)', 4) + paint(colour, 0) + '</g>';
  }

  /**
   * How big a step's picture is, as far as anything outside the window can
   * know: the captured frame for a screenshot, the recorded size for a
   * photograph. A square is the fallback - marks are percentages, so they still
   * land in the right place, and only the thickness of a stroke is affected.
   */
  function sizeOf(step) {
    const frame = step && step.frame;
    if (frame && frame.w > 0 && frame.h > 0) return { w: frame.w, h: frame.h };
    const size = step && step.size;
    if (size && size.w > 0 && size.h > 0) return { w: size.w, h: size.h };
    return { w: 1000, h: 1000 };
  }

  /**
   * Every mark on a step, as one overlay sized to the picture.
   *
   * `selected` draws a dashed box around one of them. It is an option rather
   * than a property of the mark because it is a fact about the WINDOW, not
   * about the recording: an export calls this without it, and so cannot print
   * somebody's selection into a document by accident.
   */
  function svgAll(marks, width, height, { selected = null } = {}) {
    const list = (marks || []).filter(Boolean);
    if (!list.length) return '';
    // Stretched, not fitted. The overlay is laid over a picture whose
    // displayed shape is decided by a stylesheet somewhere else; letterboxing
    // it to preserve the aspect ratio would put every mark in the wrong place
    // rather than merely drawing it slightly wrong.
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" `
         + `preserveAspectRatio="none" width="${width}" height="${height}">`
         + list.map((m) => svgFor(m, width, height)).join('')
         + (selected ? outlineFor(list.find((m) => m.id === selected), width, height) : '')
         + '</svg>';
  }

  /**
   * A dashed box around the selected mark, drawn in the picture's own pixels.
   *
   * Two strokes, dark under pale, for the same reason every mark has a pale
   * outline: this has to be visible on a white dialog and on a dark terminal,
   * and one colour cannot be.
   */
  function outlineFor(mark, width, height) {
    if (!mark) return '';
    const b = boundsOf(mark, 1.5);
    const x = (b.x / 100) * width;
    const y = (b.y / 100) * height;
    const w = (b.w / 100) * width;
    const h = (b.h / 100) * height;
    const dash = Math.max(4, Math.round(Math.min(width, height) / 90));
    const line = (c, sw) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" `
                          + `fill="none" stroke="${c}" stroke-width="${sw}" `
                          + `stroke-dasharray="${dash} ${dash}"/>`;
    return `<g class="mark-selection">`
         + line('rgba(255,255,255,.9)', dash * 0.9)
         + line('#1f6feb', dash * 0.45)
         + '</g>';
  }

  /**
   * The box a mark occupies, in percentages, for working out which one somebody
   * clicked on.
   *
   * Generous around thin things on purpose: an arrow is a line, and a line is
   * nearly impossible to hit with a mouse. A few percent of slack turns "click
   * exactly on the shaft" into "click near the arrow", which is what a person
   * means by clicking on it.
   */
  function boundsOf(mark, pad = 1.5) {
    if (mark.tool === 'arrow') {
      return {
        x: Math.min(mark.from.x, mark.to.x) - pad,
        y: Math.min(mark.from.y, mark.to.y) - pad,
        w: Math.abs(mark.to.x - mark.from.x) + pad * 2,
        h: Math.abs(mark.to.y - mark.from.y) + pad * 2,
      };
    }
    if (mark.tool === 'text') {
      // Lettering hangs to the right of and above its anchor, which is the
      // baseline at the left end of the line.
      const len = Math.max(1, String(mark.text || '').length);
      return { x: mark.at.x - pad, y: mark.at.y - 6 - pad,
               w: Math.min(100, len * 1.4) + pad * 2, h: 8 + pad * 2 };
    }
    return { x: Math.min(mark.rect.x, mark.rect.x + mark.rect.w) - pad,
             y: Math.min(mark.rect.y, mark.rect.y + mark.rect.h) - pad,
             w: Math.abs(mark.rect.w) + pad * 2,
             h: Math.abs(mark.rect.h) + pad * 2 };
  }

  /**
   * The same mark, shifted by a distance in percentage points.
   *
   * Every tool's geometry moves here, in one place, because "move it" is one
   * idea and three implementations of it would drift apart the first time a
   * fourth shape was added.
   */
  function movedBy(mark, dx, dy) {
    if (mark.tool === 'arrow') {
      return { ...mark,
               from: { x: mark.from.x + dx, y: mark.from.y + dy },
               to: { x: mark.to.x + dx, y: mark.to.y + dy } };
    }
    if (mark.tool === 'text') {
      return { ...mark, at: { x: mark.at.x + dx, y: mark.at.y + dy } };
    }
    return { ...mark,
             rect: { ...mark.rect, x: mark.rect.x + dx, y: mark.rect.y + dy } };
  }

  /**
   * The points on a mark that can be taken hold of, in percentages.
   *
   * An arrow's are its two ends, and dragging one is how it is aimed: swinging
   * the tail turns it about the tip, which is the end that is pointing at
   * something and the end that must not move. There is deliberately no separate
   * rotate control - a handle on each end is one idea rather than two, and it
   * changes the length as well, which is the other half of "that arrow is
   * wrong".
   *
   * The other shapes get their four corners, for the same reason: a box drawn
   * two fields too short could only be deleted and drawn again.
   *
   * A label has none. Its size is a choice of three on the strip, and there is
   * no second point on it to drag.
   */
  function handlesOf(mark) {
    if (!mark) return [];
    if (mark.tool === 'arrow') {
      return [{ key: 'from', x: mark.from.x, y: mark.from.y },
              { key: 'to', x: mark.to.x, y: mark.to.y }];
    }
    if (mark.tool === 'text' || !mark.rect) return [];

    const { x, y, w, h } = mark.rect;
    return [{ key: 'nw', x, y },
            { key: 'ne', x: x + w, y },
            { key: 'se', x: x + w, y: y + h },
            { key: 'sw', x, y: y + h }];
  }

  const within = (v) => Math.max(0, Math.min(100, v));

  /** Turning by hand is never exact; a guide full of arrows at 43 and 47
      degrees looks like a guide nobody proofread. */
  const SNAP_DEGREES = 15;

  /**
   * The nearest fifteen degrees, at the length the arrow already has.
   *
   * `aspect` is the picture's width over its height. Marks are percentages of
   * each axis independently, so an angle worked out in those units is not the
   * angle anybody sees on a picture that is not square - snapping without it
   * would land on multiples of fifteen in a coordinate space that exists
   * nowhere except this file.
   */
  function snapAngle(fixed, end, aspect) {
    const ratio = aspect > 0 ? aspect : 1;
    const dx = (end.x - fixed.x) * ratio;
    const dy = end.y - fixed.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (!length) return end;

    const step = (SNAP_DEGREES * Math.PI) / 180;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: within(fixed.x + (Math.cos(angle) * length) / ratio),
             y: within(fixed.y + Math.sin(angle) * length) };
  }

  /**
   * The same mark with one of its handles moved to a point.
   *
   * The opposite end stays where it is - that is what makes this a rotation
   * rather than a move. `snap` is the Shift key: held, an arrow lands on a
   * multiple of fifteen degrees and a horizontal one is actually horizontal.
   */
  function withHandle(mark, key, x, y, { snap = false, aspect = 1 } = {}) {
    if (!mark) return mark;
    const at = { x: within(x), y: within(y) };

    if (mark.tool === 'arrow') {
      const fixed = key === 'from' ? mark.to : mark.from;
      const end = snap ? snapAngle(fixed, at, aspect) : at;
      return key === 'from' ? { ...mark, from: end } : { ...mark, to: end };
    }
    if (mark.tool === 'text' || !mark.rect) return mark;

    // The corner diagonally opposite the one in hand is the anchor.
    const r = mark.rect;
    const ax = (key === 'nw' || key === 'sw') ? r.x + r.w : r.x;
    const ay = (key === 'nw' || key === 'ne') ? r.y + r.h : r.y;

    // A floor on the size: a shape dragged to nothing is invisible and there is
    // then no handle left to drag it back out by.
    const w = Math.max(0.8, Math.abs(at.x - ax));
    const h = Math.max(0.8, Math.abs(at.y - ay));
    return { ...mark, rect: { ...r, x: Math.min(ax, at.x), y: Math.min(ay, at.y),
                              w, h } };
  }

  /**
   * Which mark is at a point, in percentages. The LAST one drawn wins, because
   * that is the one on top and the one a person is looking at.
   */
  function markAt(marks, x, y, pad = 1.5) {
    for (let i = (marks || []).length - 1; i >= 0; i -= 1) {
      const b = boundsOf(marks[i], pad);
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return marks[i];
    }
    return null;
  }

  /**
   * How thick a stroke should be on an image of this size.
   *
   * A fixed width is wrong twice over: three pixels vanishes on a 4K screenshot
   * and swamps a small dialog. Scaled to the image's diagonal, a mark looks the
   * same weight wherever it is drawn, and is clamped so it never disappears or
   * becomes a blob.
   */
  function strokeFor(width, height, weight = 1) {
    const diagonal = Math.sqrt(width * width + height * height);
    return Math.max(2, Math.min(14, Math.round(diagonal / 450))) * weight;
  }

  /**
   * An arrow from tail to tip. Returns the barbs as points rather than drawing
   * them, so the head can be checked for being an actual triangle - the same
   * mistake the click marker's arrow made, where both barbs were offset along
   * the shaft and the head collapsed into a line.
   */
  function arrowGeometry(from, to, stroke) {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / length;
    const uy = dy / length;

    // A head proportional to the stroke, so it stays in proportion when the
    // stroke scales with the image, but never longer than the arrow itself.
    const head = Math.min(length * 0.4, stroke * 4.5);
    const spread = head * 0.5;

    // Perpendicular to the shaft: (-uy, ux) and (uy, -ux).
    const baseX = to.x - ux * head;
    const baseY = to.y - uy * head;

    return {
      length,
      head,
      // The shaft stops short of the tip so the line does not poke through the
      // point of the head.
      shaft: { x: to.x - ux * head * 0.8, y: to.y - uy * head * 0.8 },
      barbs: [
        { x: baseX - uy * spread, y: baseY + ux * spread },
        { x: baseX + uy * spread, y: baseY - ux * spread },
      ],
    };
  }

  /** The area of the head, so a collapsed one fails a test rather than a reader. */
  function headArea(from, to, stroke) {
    const g = arrowGeometry(from, to, stroke);
    const [a, b] = g.barbs;
    return Math.abs((a.x - to.x) * (b.y - to.y) - (b.x - to.x) * (a.y - to.y)) / 2;
  }

  /**
   * Draws one mark onto a canvas context, in image pixels.
   *
   * `rect` is the dragged region, `from`/`to` the raw drag so an arrow knows
   * which end the reader should look at.
   */
  function draw(ctx, tool, { rect, from, to, width, height, colour = '#e5484d',
                             highlight = HIGHLIGHTS[0].fill }) {
    const stroke = strokeFor(width, height);

    ctx.save();
    // A pale outline under every mark, so it survives being drawn over a light
    // dialog or a dark screenshot alike.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (tool === 'highlight') {
      // Not multiply. Multiply is how a highlighter behaves on paper - it
      // darkens - so yellow over a dark interface came out as nothing at all,
      // on exactly the screenshots this tool is most often pointed at. A
      // translucent wash lightens a dark ground and tints a light one.
      //
      // And no outline. One was added while the blend was broken and the wash
      // could not be seen; a highlighter has no edge, and once the wash worked
      // the border was just a line nobody asked for.
      ctx.fillStyle = highlight;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      return;
    }

    if (tool === 'ellipse') {
      // Inscribed in the drag, so a square drag is a circle and a wider one an
      // oval - the shape follows the thing being circled.
      const cx = rect.x + rect.w / 2;
      const cy = rect.y + rect.h / 2;
      const ring = (style, width) => {
        ctx.strokeStyle = style;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(rect.w) / 2, Math.abs(rect.h) / 2, 0, 0, Math.PI * 2);
        ctx.stroke();
      };
      ring('rgba(255,255,255,.85)', stroke + 4);
      ring(colour, stroke);
      ctx.restore();
      return;
    }

    if (tool === 'box') {
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = stroke + 4;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = colour;
      ctx.lineWidth = stroke;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
      return;
    }

    // arrow
    const g = arrowGeometry(from, to, stroke);
    const paint = (style, extra) => {
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      ctx.lineWidth = stroke + extra;

      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(g.shaft.x, g.shaft.y);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(g.barbs[0].x, g.barbs[0].y);
      ctx.lineTo(g.barbs[1].x, g.barbs[1].y);
      ctx.closePath();
      ctx.fill();
      if (extra) ctx.stroke();
    };

    paint('rgba(255,255,255,.85)', 4);
    paint(colour, 0);
    ctx.restore();
  }

  /** Whether a drag is big enough to have been meant. */
  function isDeliberate(tool, rect, from, to) {
    if (tool === 'arrow') {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      return Math.sqrt(dx * dx + dy * dy) >= 12;
    }
    return rect.w >= 6 && rect.h >= 6;
  }

  /**
   * The key for a guide: which highlighter colours it uses and what each means.
   *
   * Only the colours actually used in this recording. Listing the rest would be
   * a key to marks that are not there, which is worse than no key at all - a
   * reader would hunt for an orange mark that was never made.
   *
   * A colour used without a meaning is still listed, saying so. Silently
   * omitting it would leave a mark on the page that the key does not explain,
   * which is the thing a legend exists to prevent.
   */
  function legendFor(steps, meanings = {}) {
    const used = new Set();
    for (const step of steps || []) {
      for (const id of step.highlights || []) used.add(id);
    }

    return HIGHLIGHTS
      .filter((h) => used.has(h.id))
      .map((h) => ({
        id: h.id,
        name: h.name,
        fill: h.fill,
        meaning: String(meanings[h.id] || '').trim(),
      }));
  }

  return { TOOLS, HIGHLIGHTS, COLOURS, highlightFill, colourValue, legendFor,
           strokeFor, fontFor, arrowGeometry, headArea, draw, isDeliberate,
           SIZES, sizeScale, svgFor, svgAll, outlineFor, sizeOf, boundsOf,
           markAt, movedBy, handlesOf, withHandle, pixelsOf, escapeXml };
}));
