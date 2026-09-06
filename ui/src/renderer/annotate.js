/**
 * The marks a person adds to a screenshot: a box, an arrow, a highlight.
 *
 * A recorder can say where the click landed. It cannot say "this is the field
 * that matters" or "look here first" - that is the author's knowledge, and
 * without a way to add it every screenshot is a flat picture of a screen.
 *
 * Drawn into the image itself rather than stored beside it. Storing them as
 * data would keep them editable, but Word embeds the picture and cannot layer
 * anything over it, so an annotation held as data would be missing from the one
 * format most likely to reach a company. Burning it in means every format shows
 * the same thing. The cost is that it cannot be restyled afterwards, which is
 * why the pre-edit image is stashed for undo - the same bargain blur makes.
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

  const TOOLS = ['box', 'arrow', 'highlight'];

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
  function draw(ctx, tool, { rect, from, to, width, height, colour = '#e5484d' }) {
    const stroke = strokeFor(width, height);

    ctx.save();
    // A pale outline under every mark, so it survives being drawn over a light
    // dialog or a dark screenshot alike.
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    if (tool === 'highlight') {
      // Not multiply. Multiply is how a highlighter behaves on paper - it
      // darkens - so yellow over a dark interface came out as nothing at all,
      // and the whole mark was invisible on exactly the screenshots this tool
      // is most often pointed at. A translucent wash lightens a dark ground and
      // tints a light one, and the outline keeps the edge findable on both.
      ctx.fillStyle = 'rgba(255, 224, 66, 0.32)';
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.strokeStyle = 'rgba(255, 214, 0, 0.9)';
      ctx.lineWidth = Math.max(2, stroke * 0.6);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
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

  return { TOOLS, strokeFor, arrowGeometry, headArea, draw, isDeliberate };
}));
