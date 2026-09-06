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
  // The tip sits at the click; a few pixels back along the shaft is solid head.
  const back = Math.round(am.width * 0.12);
  const [tip, tail] = await pixels(a.images.get(shot).data,
                                   [[400 - back, 300 - back], [5, 5]]);
  check(`the head is drawn at the click (${tip})`, isMarker(tip));
  check('and the corner is still the picture', isGrey(tail));

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

  if (reader) reader.destroy();
  composite.dispose();
  fs.rmSync(dir, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
