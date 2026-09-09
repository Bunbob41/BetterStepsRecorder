/**
 * Drawing the click marker into the screenshot, for Word.
 *
 * Needs a real renderer, so it runs under Electron:
 *
 *   npm run test:composite      (from ui/)
 *
 * The check that matters is not "a buffer came back" - it is that the pixels
 * where the marker should be are now the marker's colour and the pixels
 * elsewhere are not. Every other kind of assertion here would pass just as
 * happily against a function that returned the image unchanged.
 */
const { app } = require('electron');
const path = require('node:path');

const composite = require(path.join(__dirname, '..', 'ui', 'src', 'main', 'composite'));
const marker = require(path.join(__dirname, '..', 'ui', 'src', 'renderer', 'marker'));
const { solidPng } = require('./png-fixture');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const watchdog = setTimeout(() => {
  console.log('\nTIMED OUT');
  app.exit(2);
}, 90000);

const fs = require('node:fs');
const os = require('node:os');

const dir = path.join(os.tmpdir(), 'bsr-composite-' + Date.now());
fs.mkdirSync(dir, { recursive: true });

const GREY = [90, 96, 110];
const shot = path.join(dir, 'shot.png');
fs.writeFileSync(shot, solidPng(800, 600, GREY));

/**
 * Reads pixels back, by decoding in a window - the only decoder here is a
 * browser. One window for every read: creating and destroying them in turn is
 * what made the second one fail to load anything at all.
 */
let reader = null;
async function pixels(buffer, points) {
  const { BrowserWindow } = require('electron');
  if (!reader) {
    reader = new BrowserWindow({ show: false, width: 16, height: 16 });
    await reader.loadURL('data:text/html,<!doctype html><meta charset="utf-8">');
  }
  const win = reader;
  {
    const src = 'data:image/png;base64,' + buffer.toString('base64');
    return await win.webContents.executeJavaScript(`(async () => {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = ${JSON.stringify(src)}; });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0);
      return ${JSON.stringify(points)}.map(([px, py]) => {
        const d = x.getImageData(px, py, 1, 1).data;
        return [d[0], d[1], d[2]];
      });
    })()`);
  }
}

const isGrey = ([r, g, b]) =>
  Math.abs(r - GREY[0]) < 12 && Math.abs(g - GREY[1]) < 12 && Math.abs(b - GREY[2]) < 12;

/** The marker's red is far from the background in the red channel alone. */
const isMarker = ([r, g, b]) => r > 150 && r - b > 40;

app.whenReady().then(async () => {
  console.log('the marker is drawn into the image:');

  const centre = { x: 50, y: 50 };
  const r = await composite.markAll([{ file: shot, pos: centre }],
                                    { markerOpts: { style: 'circle' } });

  check('every screenshot given a position is marked', r.marked === 1);
  check('and none failed', r.failed === 0);

  const out = r.images.get(shot);
  check('the result is a buffer, not a path', Buffer.isBuffer(out.data));
  check('and is still a PNG', out.ext === '.png');
  check('the original file on disk is untouched',
        fs.readFileSync(shot).equals(solidPng(800, 600, GREY)));

  // Where the ring should be, and where it should not. A circle at 50/50 of an
  // 800x600 image is centred at (400, 300); the plan puts its edge half a
  // diameter away, scaled for an image this wide.
  const m = marker.svg(centre, { style: 'circle' }, '#e5484d', 800, 600);
  const edgeX = Math.round(m.left + m.width / 2);   // top of the ring
  const edgeY = m.top + 2;

  const [onRing, atCentre, farAway, corner] =
    await pixels(out.data, [[edgeX, edgeY], [400, 300], [120, 120], [5, 5]]);

  check(`the ring is on the image where it belongs (${onRing})`, isMarker(onRing));
  // A ring, not a disc: what it points at has to stay visible, which is the
  // whole reason it is a ring.
  check(`the middle is left alone (${atCentre})`, isGrey(atCentre));
  check(`and so is the rest of the picture (${farAway})`, isGrey(farAway));
  check('right down to the corner', isGrey(corner));

  console.log('\nan arrow, which is a different shape entirely:');
  const a = await composite.markAll([{ file: shot, pos: { x: 50, y: 50 } }],
                                    { markerOpts: { style: 'arrow' } });
  const am = marker.svg({ x: 50, y: 50 }, { style: 'arrow' }, '#e5484d', 800, 600);
  // The tip sits at the click; a short way back along the shaft is solid head.
  //
  // Measured along the DRAWN LENGTH, not the bounding box. The box is now the
  // shape of the arrow rather than a square, so a fraction of its width is a
  // different distance at every angle - and this probe silently walked off the
  // head the moment the geometry stopped being a diagonal.
  const back = Math.round(am.length * 0.15 * Math.SQRT1_2);
  const [tip, tail] = await pixels(a.images.get(shot).data,
                                   [[400 - back, 300 - back], [5, 5]]);
  check(`the head is drawn at the click (${tip})`, isMarker(tip));
  check('and the corner is still the picture', isGrey(tail));

  console.log('\nand it points wherever it is turned:');
  {
    // The tip stays on the click at every angle; the shaft runs away from it in
    // the direction the arrow was turned to. So a short way BACK along that
    // direction is solid marker, and the same distance FORWARD - past the tip -
    // is untouched picture. That pair is what "points the right way" means, and
    // it is checked in pixels because the geometry is easy to get subtly wrong
    // and impossible to eyeball at this size.
    for (const angle of [0, 90, 180, 270]) {
      const rad = (angle * Math.PI) / 180;
      const vx = Math.cos(rad);
      const vy = Math.sin(rad);

      const marked = await composite.markAll(
        [{ file: shot, pos: { x: 50, y: 50 }, opts: { angle } }],
        { markerOpts: { style: 'arrow' } });

      const g = marker.svg({ x: 50, y: 50 }, { style: 'arrow', angle },
                           '#e5484d', 800, 600);
      const d = g.length * 0.15;

      const behind = [Math.round(400 - vx * d), Math.round(300 - vy * d)];
      const beyond = [Math.round(400 + vx * d * 2.2), Math.round(300 + vy * d * 2.2)];

      const [onShaft, past] = await pixels(marked.images.get(shot).data,
                                           [behind, beyond]);
      check(`at ${angle} degrees the shaft is behind the click (${onShaft})`,
            isMarker(onShaft));
      check(`  and nothing is drawn past it (${past})`, isGrey(past));
    }
  }

  console.log('\nwhat happens when it cannot be done:');
  const bad = path.join(dir, 'not-an-image.png');
  fs.writeFileSync(bad, 'this is not a png');
  const errs = [];
  const b = await composite.markAll([{ file: bad, pos: centre }],
                                    { onError: (f, e) => errs.push(e.message) });
  // One unreadable file must not cost somebody their export.
  check('it is reported, not thrown', b.failed === 1 && errs.length === 1);
  check('and the file keeps whatever it had', !b.images.has(bad));

  check('nothing to mark is not an error',
        (await composite.markAll([])).marked === 0);
  check('and neither is a step with no click',
        (await composite.markAll([{ file: shot, pos: null }])).marked === 0);

  console.log('\nsized against the picture, not the page:');
  {
    // A marker of fixed pixels is a speck on a 4K screenshot and a blot on a
    // small dialog. It scales with the image's own width.
    const small = marker.svg(centre, {}, '#e5484d', 400, 300);
    const large = marker.svg(centre, {}, '#e5484d', 3840, 2160);
    check('a wider image gets a bigger marker', large.width > small.width * 4);
    check('but it is clamped, not unbounded',
          marker.svg(centre, {}, '#e5484d', 40000, 20000).width < 400);
    check('and it never vanishes on a tiny one',
          marker.svg(centre, {}, '#e5484d', 60, 40).width >= 12);

    // A height of zero used to fall through to the width, which put a click at
    // half the height of a 1080px screenshot 960px down it - off the picture,
    // and silent.
    const square = marker.svg({ x: 50, y: 50 }, {}, '#e5484d', 1920, 1920);
    const noHeight = marker.svg({ x: 50, y: 50 }, {}, '#e5484d', 1920);
    check('omitting the height does not send the marker off the picture',
          noHeight.top === square.top);
    check('and a real height is used as given',
          marker.svg({ x: 50, y: 50 }, {}, '#e5484d', 1920, 1080).top < square.top);
  }

  console.log('\nthe map it hands back is the shape everything else expects:');
  {
    const one = await composite.markAll([{ file: shot, pos: centre }]);
    const got = one.images.get(shot);
    // screenshots.prepare stores { data, mime, ext }. An entry missing `mime`
    // reaches dataUriFor - which the HTML and PDF exports go through - as
    // "data:undefined;base64,...", and renders nothing at all.
    check('an entry carries its mime type', got.mime === 'image/png');
    check('and its extension', got.ext === '.png');
    check('and its bytes', Buffer.isBuffer(got.data));

    // Entries it did not touch must come through untouched.
    const passthrough = new Map([['C:/elsewhere.png',
                                  { data: Buffer.from('x'), mime: 'image/jpeg', ext: '.jpg' }]]);
    const mixed = await composite.markAll([{ file: shot, pos: centre }],
                                          { images: passthrough });
    check('an unmarked entry is left exactly as it was',
          mixed.images.get('C:/elsewhere.png').mime === 'image/jpeg');
    check('and the caller\u2019s map is not modified',
          passthrough.size === 1 && !passthrough.has(shot));
  }

  console.log('\none screenshot, one marker, however many steps use it:');
  {
    // Two steps can point at one screenshot - session.js keeps the file while
    // either still references it. Marking is keyed by file and each pass reads
    // what the last one wrote, so without a guard the second step's marker is
    // drawn onto the first step's result and both appear on both.
    const twice = await composite.markAll([
      { file: shot, pos: { x: 25, y: 25 } },
      { file: shot, pos: { x: 75, y: 75 } },
    ], { markerOpts: { style: 'circle' } });

    check('it is marked once', twice.marked === 1);
    check('and the repeat is reported rather than silently done', twice.shared === 1);

    const a = marker.svg({ x: 25, y: 25 }, { style: 'circle' }, '#e5484d', 800, 600);
    const b = marker.svg({ x: 75, y: 75 }, { style: 'circle' }, '#e5484d', 800, 600);
    const [first, second] = await pixels(twice.images.get(shot).data, [
      [Math.round(a.left + a.width / 2), a.top + 2],
      [Math.round(b.left + b.width / 2), b.top + 2],
    ]);
    check(`the first step\u2019s marker is there (${first})`, isMarker(first));
    check(`and the second step\u2019s is not (${second})`, isGrey(second));
  }

  // ---- and into a real Word document ---------------------------------------
  // The point of all of this. Word embeds a picture and cannot lay anything
  // over it, so unless the marker is in the bytes that go into the zip, it is
  // not in the document - and every check above would still pass.
  console.log('\nand it survives into the .docx:');
  {
    const docx = require(path.join(__dirname, '..', 'ui', 'src', 'main', 'docx'));
    const JSZip = require(path.join(__dirname, '..', 'ui', 'node_modules', 'jszip'));
    const tpl = path.join(__dirname, '..', 'templates', 'corporate-sop.docx');

    const sdir = path.join(dir, 'session');
    fs.mkdirSync(path.join(sdir, 'steps'), { recursive: true });
    const rel = 'steps/0001.png';
    fs.writeFileSync(path.join(sdir, rel), solidPng(800, 600, GREY));

    const session = { dir: sdir, name: 'Marked', steps: [{
      id: 'a', action: 'leftClick', text: 'Clicked the "Save" button',
      point: { x: 400, y: 300 }, frame: { x: 0, y: 0, w: 800, h: 600 },
      window: { title: 'App', process: 'app.exe' }, screenshot: rel,
    }] };

    const abs = path.join(sdir, rel);
    const marks = await composite.markAll([{ file: abs, pos: { x: 50, y: 50 } }],
                                          { markerOpts: { style: 'circle' } });

    const { buffer } = await docx.render(tpl, session, {
      title: 'Marked', brand: null, redactionSummary: '', images: marks.images });

    const zip = await JSZip.loadAsync(buffer);
    const media = Object.keys(zip.files)
      .filter((f) => f.startsWith('word/media/') && !zip.files[f].dir);
    check(`a screenshot is embedded (${media.length})`, media.length === 1);

    const bytes = await zip.file(media[0]).async('nodebuffer');
    const m = marker.svg({ x: 50, y: 50 }, { style: 'circle' }, '#e5484d', 800, 600);
    const [ring, middle] = await pixels(bytes,
      [[Math.round(m.left + m.width / 2), m.top + 2], [400, 300]]);

    check(`the marker is in the bytes Word will show (${ring})`, isMarker(ring));
    check(`and it is still a ring, not a blob (${middle})`, isGrey(middle));

    // Without the images map the document must be exactly as it always was:
    // this feature must not have quietly changed the unmarked path.
    const plain = await docx.render(tpl, session, {
      title: 'Marked', brand: null, redactionSummary: '' });
    const pz = await JSZip.loadAsync(plain.buffer);
    const pm = Object.keys(pz.files).filter((f) => f.startsWith('word/media/')
                                                && !pz.files[f].dir);
    const pbytes = await pz.file(pm[0]).async('nodebuffer');
    check('an export given no marks embeds the original untouched',
          pbytes.equals(fs.readFileSync(abs)));
  }

  // ---------------------------------------------------------------------------
  // Marks a person drew, burned into the picture.
  //
  // This is the whole justification for holding them as data. They are an
  // overlay in the window, in the HTML and in the PDF; Word embeds the picture
  // and can lay nothing over it, so if they do not arrive HERE they are simply
  // missing from the format most likely to reach a company - and the author
  // would have no way of knowing.
  console.log('\nthe marks somebody drew, in the pixels:');
  {
    const BLUE = [47, 111, 237];        // annotate's 'blue'
    const isBlue = ([r, g, b]) => Math.abs(r - BLUE[0]) < 60
                               && Math.abs(g - BLUE[1]) < 60
                               && Math.abs(b - BLUE[2]) < 70;

    // A box around the middle quarter of an 800x600 picture: from (200,150) to
    // (600,450) in pixels.
    const box = { id: 'm1', tool: 'box', colour: 'blue',
                  rect: { x: 25, y: 25, w: 50, h: 50 } };

    const marked = await composite.markAll(
      [{ file: shot, marks: [box] }], {});

    check('a step with marks and no click is still worked on', marked.marked === 1);

    const [onEdge, insideBox, outside] = await pixels(
      marked.images.get(shot).data,
      [[200, 300],      // the left edge of the box
       [400, 300],      // the middle of it, which a box does not fill
       [40, 40]]);      // well outside

    check(`the edge of the box is drawn (${onEdge})`, isBlue(onEdge));
    check(`its middle is left alone (${insideBox})`, isGrey(insideBox));
    check(`and so is the rest of the picture (${outside})`, isGrey(outside));

    // And with a click marker as well: the two must not fight over the file.
    const both = await composite.markAll(
      [{ file: shot, pos: { x: 50, y: 50 }, marks: [box] }],
      { markerOpts: { style: 'circle' } });
    // The top of the ring, not its middle: a circle marker is hollow, and the
    // pixel at the click is the picture showing through it.
    const ring = marker.svg({ x: 50, y: 50 }, { style: 'circle' }, '#e5484d', 800, 600);
    const [edgeAgain, onRing] = await pixels(
      both.images.get(shot).data,
      [[200, 300], [Math.round(ring.left + ring.width / 2), ring.top + 2]]);
    check(`the mark survives alongside the click marker (${edgeAgain})`,
          isBlue(edgeAgain));
    check(`and the marker is drawn as well (${onRing})`, isMarker(onRing));

    // A highlight is a translucent wash: the pixels under it change without
    // becoming the mark's own colour, which is the only way to tell it apart
    // from a box that was drawn as a fill by mistake.
    const wash = await composite.markAll(
      [{ file: shot,
         marks: [{ id: 'm2', tool: 'highlight', colour: 'yellow',
                   rect: { x: 10, y: 10, w: 30, h: 30 } }] }], {});
    const [washed, unwashed] = await pixels(
      wash.images.get(shot).data, [[150, 150], [700, 500]]);
    check(`a highlight tints what is under it (${washed})`, !isGrey(washed));
    check(`and leaves the rest (${unwashed})`, isGrey(unwashed));
  }

  if (reader) reader.destroy();
  composite.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  clearTimeout(watchdog);
console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
