/**
 * What a photograph becomes on its way into a recording - measured, in pixels.
 *
 * Needs a real image decoder, so it needs Electron. `photos_test.js` covers the
 * half that does not.
 *
 * The size rule is the reason this exists. A photograph off a phone is four or
 * five thousand pixels wide and several megabytes; forty of them in a recording
 * is a folder nobody can email and a Word document that will not open. So they
 * are brought down to 2000 pixels on the LONG edge - by the long edge, because
 * a photo held upright is as common as one held sideways, and resizing by width
 * would shrink a landscape photo correctly and leave a portrait one enormous.
 *
 *   npx electron tests/photos_image_test.js
 */
const { app, nativeImage } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  c ? (pass++, console.log('  PASS ' + n))
    : (fail++, console.log('  FAIL ' + n + (extra ? ` — ${extra}` : '')));
};

app.whenReady().then(async () => {
  const photos = require('../ui/src/main/photos');

  const dir = path.join(os.tmpdir(), 'bsr-photo-img-' + Date.now());
  fs.mkdirSync(dir, { recursive: true });

  /** A PNG of a given size, standing in for something off a camera. */
  const makePng = (name, w, h) => {
    const file = path.join(dir, name);
    // A canvas of solid colour: the pixels do not matter, the dimensions do.
    const buf = Buffer.alloc(w * h * 4);
    for (let i = 0; i < buf.length; i += 4) {
      buf[i] = 40; buf[i + 1] = 90; buf[i + 2] = 200; buf[i + 3] = 255;
    }
    const img = nativeImage.createFromBuffer(buf, { width: w, height: h });
    fs.writeFileSync(file, img.toPNG());
    return file;
  };

  console.log('a photograph wider than it is tall:');
  {
    const file = makePng('wide.png', 4000, 3000);
    const r = photos.convert(file);
    check('is converted', !r.error, r.error);
    const out = nativeImage.createFromBuffer(r.data).getSize();
    check('to 2000 on its long edge', out.width === 2000, `${out.width}x${out.height}`);
    check('keeping its shape', Math.abs(out.height - 1500) <= 2, `${out.width}x${out.height}`);
    check('as JPEG', r.ext === '.jpg' && r.data[0] === 0xff && r.data[1] === 0xd8);
    check('and smaller than it arrived',
          r.data.length < fs.statSync(file).size,
          `${r.data.length} vs ${fs.statSync(file).size}`);
  }

  console.log('\nand one held upright:');
  {
    // The case a width-only resize gets wrong: 3000x4000 is already narrower
    // than 2000 would make a landscape photo, so resizing by width leaves it
    // taller than the page it is going on.
    const r = photos.convert(makePng('tall.png', 3000, 4000));
    const out = nativeImage.createFromBuffer(r.data).getSize();
    check('is 2000 on ITS long edge, which is the height',
          out.height === 2000, `${out.width}x${out.height}`);
    check('and narrower than it is tall', out.width < out.height);
  }

  console.log('\na photograph already small enough:');
  {
    const r = photos.convert(makePng('small.png', 800, 600));
    const out = nativeImage.createFromBuffer(r.data).getSize();
    // Enlarging adds bytes and no detail, and makes a phone snap look worse
    // than it is.
    check('is left at the size it was', out.width === 800 && out.height === 600,
          `${out.width}x${out.height}`);
    check('and is still converted to JPEG', r.ext === '.jpg');
  }

  console.log('\nand the ones that cannot be read:');
  {
    const broken = path.join(dir, 'broken.png');
    fs.writeFileSync(broken, 'this is not a PNG');
    const r = photos.convert(broken);
    check('a damaged file is reported, not thrown', Boolean(r.error), JSON.stringify(r));
    check('by name', r.error.includes('broken.png'));
    const missing = photos.convert(path.join(dir, 'nothing-here.jpg'));
    check('so is one that is not there', Boolean(missing.error));
  }

  // ---------------------------------------------------------------------------
  // The whole route, as somebody actually uses it: photographs copied into a
  // recording's folder, the recording opened, the pictures in the guide.
  console.log('\nphotos dropped in the folder, then the recording opened:');
  {
    const { Session } = require('../ui/src/main/session');
    const { buildLatex } = require('../ui/src/main/latex');

    const rec = path.join(os.tmpdir(), 'bsr-photo-route-' + Date.now());
    fs.mkdirSync(path.join(rec, 'steps'), { recursive: true });
    const session = new Session(rec);
    session.addStep({ id: 'click1', seq: 1, action: 'leftClick',
                      text: 'Clicked the "Start" button',
                      point: { x: 4, y: 3 },
                      window: { title: 'App', process: 'app.exe',
                                rect: { x: 0, y: 0, w: 8, h: 6 } },
                      screenshot: 'steps/0001.png' });

    // Two photographs, put in the folder the way a person would - copied in
    // from a camera, sitting beside session.json.
    fs.copyFileSync(path.join(dir, 'wide.png'), path.join(rec, 'DSC_0100.png'));
    fs.copyFileSync(path.join(dir, 'tall.png'), path.join(rec, 'DSC_0101.png'));
    fs.writeFileSync(path.join(rec, 'notes.txt'), 'not a photo');

    const found = photos.waiting(rec);
    check('both photos are found in the folder', found.length === 2, found.join(', '));

    const taken = photos.importInto(session, found);
    check('and both become steps', taken.added.length === 2);
    check('with nothing reported as failed', taken.failed.length === 0,
          taken.failed.join(' '));
    check('the recording now has three steps', session.steps.length === 3);
    check('the photos are after the recorded step, in the order they were named',
          session.steps[1].source === 'DSC_0100.png'
          && session.steps[2].source === 'DSC_0101.png',
          session.steps.map((x) => x.source || x.action).join(', '));

    const pictures = session.steps.slice(1)
      .map((x) => path.join(rec, x.screenshot));
    check('their pictures are inside the recording',
          pictures.every((p) => fs.existsSync(p)));
    check('and are the shrunk JPEGs, not the files that were dropped in',
          pictures.every((p) => p.endsWith('.jpg')
            && nativeImage.createFromPath(p).getSize().width <= 2000));

    // The originals are kept, because the recording only holds a smaller copy.
    check('the file that was dropped in is moved out of the way',
          !fs.existsSync(path.join(rec, 'DSC_0100.png')));
    check('and kept, at full size, in originals',
          fs.existsSync(path.join(rec, 'originals', 'DSC_0100.png')));
    check('what was not a photograph is untouched',
          fs.existsSync(path.join(rec, 'notes.txt')));

    // The check this route exists to pass. Opening a recording again must not
    // take the same pictures in a second time.
    const again = photos.waiting(rec);
    check('opening it again finds nothing left to take in',
          again.length === 0, again.join(', '));

    // And they survive being reopened, which is where the step list comes from.
    const reopened = Session.load(rec);
    check('the photo steps are in the reopened recording',
          reopened.steps.filter((x) => x.action === 'photo').length === 2);

    // Into a document. A photograph has no click, no window and no frame, so
    // this is where a marker or a window name would break if anything assumed
    // every step had been captured from a screen.
    const tex = buildLatex(reopened, {
      title: 'Fitting the unit',
      imageDir: 'images',
      imageRef: (st) => (st.screenshot ? `images/${path.basename(st.screenshot)}` : null),
    });
    check('each photo is a numbered step in the export',
          (tex.match(/\\item /g) || []).length === 3, tex);
    check('and carries its picture',
          (tex.match(/includegraphics/g) || []).length === 3);
    check('with no window name invented for it',
          !/\\par\\emph\{\}/.test(tex));

    fs.rmSync(rec, { recursive: true, force: true });
  }

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nsizing a picture that is already in hand:');
{
  // What a LaTeX export ships is the marked screenshot, which is a buffer and
  // never had a file of its own.
  const { toJpegFrom } = require('../ui/src/main/transcode');
  const { solidPngDataUrl } = require('./png-fixture');
  const wide = Buffer.from(solidPngDataUrl(2400, 1000).split(',')[1], 'base64');

  const sized = toJpegFrom(wide, { maxWidth: 1600, quality: 85 });
  check('a picture in hand comes back re-encoded', Boolean(sized && sized.data.length));
  check('as a JPEG, named as one', sized.ext === '.jpg' && sized.mime === 'image/jpeg');
  const back = nativeImage.createFromBuffer(sized.data);
  check('sized down to the page width', back.getSize().width === 1600,
        `${back.getSize().width}px`);
  check('and not stretched taller', back.getSize().height < 1000);

  const small = Buffer.from(solidPngDataUrl(800, 600).split(',')[1], 'base64');
  const left = toJpegFrom(small, { maxWidth: 1600 });
  check('one already narrower than the page is not enlarged',
        nativeImage.createFromBuffer(left.data).getSize().width === 800);

  check('and something that is not a picture at all costs nothing',
        toJpegFrom(Buffer.from('not a picture')) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
});
