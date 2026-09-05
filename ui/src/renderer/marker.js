/**
 * The indicator that shows where a step was clicked.
 *
 * Shared, deliberately, by the preview in this window and by the exported
 * document. They were separate copies of the same 34px red circle in two files,
 * which is how a preview starts quietly disagreeing with what it is previewing.
 * It loads as a plain script in the renderer and is required by the exporter in
 * the main process, so there is one definition of the shape and one of the CSS.
 *
 * A red ring reads as an error to some people, or as part of the application
 * being documented rather than an annotation on it. An arrow does not: it comes
 * from outside the interface and points inward, which is unambiguously a note
 * about the picture rather than something in it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrMarker = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const DEFAULTS = { style: 'circle', bold: false };

  /** Circle diameters and arrow lengths, in pixels, plain and bold. */
  const SIZES = {
    circle: { plain: 34, bold: 46 },
    arrow: { plain: 54, bold: 74 },
  };
  const STROKE = { plain: 3, bold: 5 };

  /**
   * Which way an arrow should come from, so that it stays inside the picture.
   *
   * `pos` is the click point as a percentage of the image. An arrow pointing
   * down-right is the natural reading order, so that is the default; near the
   * top or left edge there is no room for its tail and it flips.
   */
  function direction(pos) {
    return {
      dx: pos.x < 28 ? -1 : 1,   // -1: tail is to the right of the tip
      dy: pos.y < 28 ? -1 : 1,   // -1: tail is below the tip
    };
  }

  /**
   * Pure geometry, so the awkward cases are testable without a document:
   * where the element sits, how big it is, and where its tip falls inside it.
   */
  function plan(pos, opts = {}) {
    const { style, bold } = { ...DEFAULTS, ...opts };
    const weight = bold ? 'bold' : 'plain';

    if (style !== 'arrow') {
      const size = SIZES.circle[weight];
      return { style: 'circle', size, stroke: STROKE[weight],
               offsetX: size / 2, offsetY: size / 2 };
    }

    const size = SIZES.arrow[weight];
    const { dx, dy } = direction(pos);
    // The tip sits at whichever corner the arrow points into.
    return {
      style: 'arrow', size, stroke: STROKE[weight], dx, dy,
      tipX: dx > 0 ? size : 0,
      tipY: dy > 0 ? size : 0,
      offsetX: dx > 0 ? size : 0,
      offsetY: dy > 0 ? size : 0,
    };
  }

  /** The arrow itself. Drawn twice: a pale halo, then the colour on top, so it
   *  stays visible over both a dark screenshot and a white dialog. */
  function arrowSvg(p, colour) {
    const tailX = p.size - p.tipX;
    const tailY = p.size - p.tipY;
    // The head's barbs, pulled back along the shaft and spread either side.
    const back = p.size * 0.34;
    const spread = p.size * 0.17;
    const bx = p.tipX - p.dx * back;
    const by = p.tipY - p.dy * back;

    const shaft = `M ${tailX} ${tailY} L ${p.tipX} ${p.tipY}`;
    // The barbs sit either side of the shaft, so they must be PERPENDICULAR to
    // it: (-dy, dx) and (dy, -dx). Offsetting both by (dy, dx) put all three
    // points on the shaft's own diagonal and the head collapsed to a line -
    // which drew as a plain stroke with no point on it at all.
    const head = `M ${p.tipX} ${p.tipY} L ${bx - p.dy * spread} ${by + p.dx * spread} `
               + `L ${bx + p.dy * spread} ${by - p.dx * spread} Z`;

    return `<svg width="${p.size}" height="${p.size}" viewBox="0 0 ${p.size} ${p.size}" `
         + `fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">`
         + `<path d="${shaft}" stroke="rgba(255,255,255,.85)" stroke-width="${p.stroke + 4}" stroke-linecap="round"/>`
         + `<path d="${head}" fill="rgba(255,255,255,.85)" stroke="rgba(255,255,255,.85)" stroke-width="4" stroke-linejoin="round"/>`
         + `<path d="${shaft}" stroke="${colour}" stroke-width="${p.stroke}" stroke-linecap="round"/>`
         + `<path d="${head}" fill="${colour}"/>`
         + `</svg>`;
  }

  /**
   * Every declaration the marker element needs, as one object.
   *
   * This is the single source: the exporter turns it into an inline style
   * string, and the window applies it property by property. It cannot be a
   * stylesheet in the window, because the renderer runs under
   * `style-src 'self'`, which blocks both an injected <style> element and a
   * style="..." attribute. Written as a stylesheet this feature was silently
   * inert in the preview while working perfectly in the export - the exact
   * disagreement between preview and document this module exists to prevent.
   */
  function declarations(pos, opts = {}, colour = '#e5484d') {
    const p = plan(pos, opts);
    const d = {
      position: 'absolute',
      left: `${pos.x.toFixed(2)}%`,
      top: `${pos.y.toFixed(2)}%`,
      marginLeft: `-${p.offsetX}px`,
      marginTop: `-${p.offsetY}px`,
      width: `${p.size}px`,
      height: `${p.size}px`,
      pointerEvents: 'none',
    };

    if (p.style === 'circle') {
      d.border = `${p.stroke}px solid ${colour}`;
      d.borderRadius = '50%';
      d.boxShadow = '0 0 0 2px rgba(255,255,255,.65), inset 0 0 0 1px rgba(0,0,0,.25)';
      d.boxSizing = 'border-box';
    }
    return { plan: p, declarations: d };
  }

  /** camelCase to the hyphenated form a style attribute needs. */
  function toCss(d) {
    return Object.entries(d)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}:${v}`)
      .join(';');
  }

  /** For the exported document, which has no content policy to satisfy. */
  function html(pos, opts = {}, colour = '#e5484d') {
    const { plan: p, declarations: d } = declarations(pos, opts, colour);
    const cls = `bsr-marker bsr-${p.style}${opts.bold ? ' bsr-bold' : ''}`;
    const inner = p.style === 'arrow' ? arrowSvg(p, colour) : '';
    return `<span class="${cls}" style="${toCss(d)}">${inner}</span>`;
  }

  /**
   * For the window. Builds the element and sets each property through the
   * CSSOM, which the content policy permits where an attribute would not.
   */
  function render(pos, opts = {}, colour = '#e5484d') {
    const { plan: p, declarations: d } = declarations(pos, opts, colour);
    const el = document.createElement('span');
    el.className = `bsr-marker bsr-${p.style}${opts.bold ? ' bsr-bold' : ''}`;
    for (const [k, v] of Object.entries(d)) el.style[k] = v;
    // Attributes, not CSS, so the policy does not apply.
    if (p.style === 'arrow') el.innerHTML = arrowSvg(p, colour);
    return el;
  }

  return { DEFAULTS, SIZES, direction, plan, declarations, toCss,
           html, render, arrowSvg };
}));
