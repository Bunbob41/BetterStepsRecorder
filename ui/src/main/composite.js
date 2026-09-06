/**
 * Draws the click marker into the screenshot itself.
 *
 * HTML and PDF lay the marker over the picture with CSS, which is why it can be
 * restyled from Settings and costs the export nothing. Word cannot: it embeds a
 * picture and has no way to put anything on top of it, so for the format most
 * likely to reach a company the single most important thing on a screenshot -
 * where to click - was simply absent.
 *
 * The only way to put it there is to burn it into the pixels, which needs
 * something that can draw. There is no image library in this project and adding
 * a native one would cost the "no build tools, one file" install, so the drawing
 * is done by the one renderer already present: an offscreen window with a
 * canvas.
 *
 * The originals are never touched. This produces buffers that go into the same
 * `images` map the re-encoder uses, so from the exporter's side a marked
 * screenshot and a shrunk one arrive by exactly the same route.
 */
const fs = require('node:fs');
const path = require('node:path');
const marker = require('../renderer/marker');

/** A blank page with nothing in it but a canvas we drive from here. */
const BLANK = 'data:text/html,<!doctype html><meta charset="utf-8"><title>bsr</title>';

const mimeFor = (ext) =>
  ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';

/**
 * Draws `svg` at (left, top) over `source`, and hands back the result.
 *
 * Runs in the page because that is where a canvas is. Everything it needs
 * arrives as a string: this function is called once per screenshot, and a
 * closure over anything in this process would not survive the crossing.
 */
const DRAW = (source, svg, left, top, width, height, mime, quality) => `(async () => {
  const load = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('could not decode'));
    img.src = src;
  });

  const shot = await load(${JSON.stringify(source)});
  const canvas = document.createElement('canvas');
  canvas.width = shot.naturalWidth;
  canvas.height = shot.naturalHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(shot, 0, 0);

  // charset, not base64: the marker is ASCII, and btoa would throw on the
  // first non-ASCII character somebody ever puts in a colour name.
  const mark = await load('data:image/svg+xml;charset=utf-8,'
    + encodeURIComponent(${JSON.stringify(svg)}));
  ctx.drawImage(mark, ${left}, ${top}, ${width}, ${height});

  return canvas.toDataURL(${JSON.stringify(mime)}, ${quality});
})()`;

/**
 * One hidden window, kept for the life of the application.
 *
 * Not one per export. Creating a window, destroying it and creating another
 * fails: the second `loadURL` comes back ERR_FAILED and never resolves into a
 * page, so a person who exported to Word twice in one sitting got a marked
 * document and then a failed export. Keeping the window costs a blank 16x16
 * page and removes the failure entirely.
 *
 * Hidden rather than offscreen-rendered, too. Offscreen is a separate renderer
 * path meant for streaming frames out of Chromium; all this needs is a canvas.
 */
let shared = null;

async function windowFor() {
  const { BrowserWindow } = require('electron');
  if (shared && !shared.isDestroyed()) return shared;

  const win = new BrowserWindow({
    show: false,
    width: 16,
    height: 16,
    skipTaskbar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  try {
    await win.loadURL(BLANK);
  } catch (err) {
    win.destroy();
    throw err;
  }
  shared = win;
  return shared;
}

/** Lets the application let go of it on the way out. */
function dispose() {
  if (shared && !shared.isDestroyed()) shared.destroy();
  shared = null;
}

/**
 * Marks every screenshot that has a click to show.
 *
 * `items` are `{ file, pos }` - an absolute path and the click as a percentage
 * of the image, exactly as the HTML export computes it. `images` is the map the
 * re-encoder may already have filled; entries in it are used as the source, so
 * a screenshot is never decoded from the original after it has been shrunk.
 *
 * Returns a new map. A screenshot that cannot be drawn keeps whatever it had:
 * one unreadable file must not cost somebody their export, the same bargain
 * `screenshots.prepare` makes.
 */
async function markAll(items, { images = null, markerOpts = {}, colour = '#e5484d',
                                quality = 0.9, onError = null } = {}) {
  const out = new Map(images || []);
  const work = (items || []).filter((i) => i && i.file && i.pos);
  if (!work.length) return { images: out, marked: 0, failed: 0 };

  let marked = 0;
  let failed = 0;

  // Two steps can reference one screenshot - session.js supports it on purpose
  // and keeps the file while either still points at it. Marking is keyed by
  // file, and the source for each pass is whatever is already in the map, so
  // the second step's marker would be drawn onto the first step's result and
  // both would appear on both. HTML and PDF do not have this problem: they
  // overlay per step. Marking the file once keeps the two formats agreeing.
  const seen = new Set();
  let shared = 0;

  // If the window itself cannot be had, every screenshot goes in unmarked and
  // the export still happens. A missing marker is a worse document; a thrown
  // error is no document at all.
  let win;
  try {
    win = await windowFor();
  } catch (err) {
    if (onError) onError(null, err);
    return { images: out, marked: 0, failed: work.length };
  }

  {
    for (const { file, pos } of work) {
      if (seen.has(file)) { shared++; continue; }
      try {
        const prepared = out.get(file);
        const ext = prepared
          ? String(prepared.ext || '').replace('.', '').toLowerCase()
          : path.extname(file).slice(1).toLowerCase();
        const bytes = prepared ? prepared.data : fs.readFileSync(file);
        const mime = mimeFor(ext);
        const source = `data:${mime};base64,${bytes.toString('base64')}`;

        // The image's own pixels, so the marker is sized against the picture
        // rather than against whatever it is displayed at.
        const size = await win.webContents.executeJavaScript(
          `(async () => { const i = new Image(); await new Promise((res, rej) => {`
          + ` i.onload = res; i.onerror = rej; i.src = ${JSON.stringify(source)}; });`
          + ` return { w: i.naturalWidth, h: i.naturalHeight }; })()`);

        const m = marker.svg(pos, markerOpts, colour, size.w, size.h);
        const url = await win.webContents.executeJavaScript(
          DRAW(source, m.svg, m.left, m.top, m.width, m.height, mime, quality));

        const base64 = String(url).slice(String(url).indexOf(',') + 1);
        // The same shape `screenshots.prepare` produces, `mime` included.
        // Without it this map holds two kinds of entry, and the one consumer
        // that reads `.mime` - dataUriFor, which the HTML and PDF exports go
        // through - would silently emit `data:undefined;base64,...` for every
        // marked screenshot the day anybody routed this map to it.
        out.set(file, {
          data: Buffer.from(base64, 'base64'),
          mime,
          ext: mime === 'image/jpeg' ? '.jpg' : '.png',
        });
        seen.add(file);
        marked++;
      } catch (err) {
        // Keep whatever this file already had, and say so once.
        failed++;
        if (onError) onError(file, err);
      }
    }
  }

  return { images: out, marked, failed, shared };
}

module.exports = { markAll, mimeFor, dispose };
