/**
 * Photographs brought into a recording - the half that needs no image decoder.
 *
 * The dangerous part of the folder route is not reading the pictures, it is
 * knowing which ones have already been read. A recording is opened many times;
 * if the scan ever looked at a folder the imported photos end up in, every
 * opening would add them again, and nobody would notice until the same picture
 * appeared in a guide four times. So most of what is checked here is what the
 * scan REFUSES to look at.
 */
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// photos.js needs Electron for the conversion half; requiring it under plain
// node fails at the import. The scanning half is what this file is about, and
// it is reachable by loading the module with a stub in place.
const Module = require('node:module');
const realResolve = Module._resolveFilename;
const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return { nativeImage: {} };
  return realLoad.call(this, request, parent, isMain);
};
const photos = require('../ui/src/main/photos');
Module._load = realLoad;

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  c ? (pass++, console.log('  PASS ' + n))
    : (fail++, console.log('  FAIL ' + n + (extra ? ` — ${extra}` : '')));
};

const dir = path.join(os.tmpdir(), 'bsr-photos-test-' + Date.now());
fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
fs.mkdirSync(path.join(dir, 'originals'), { recursive: true });

const touch = (...parts) => fs.writeFileSync(path.join(dir, ...parts), 'x');

touch('session.json');
touch('DSC_0042.JPG');            // straight off a camera, upper case
touch('site-photo.jpeg');
touch('diagram.png');
touch('notes.txt');
touch('steps', '0001.png');       // a screenshot the recording already owns
touch('originals', 'DSC_0001.jpg');   // a photo it has already taken in

console.log('what the folder scan picks up:');
const found = photos.waiting(dir).map((f) => path.basename(f));
check('a photo dropped in the folder is found', found.includes('DSC_0042.JPG'));
check('whatever the case of its extension', found.includes('DSC_0042.JPG'));
check('and more than one of them', found.includes('site-photo.jpeg')
      && found.includes('diagram.png'));
check('anything that is not an image is left alone', !found.includes('notes.txt'));
check('and session.json certainly is', !found.includes('session.json'));

// The two that would duplicate every picture in the guide on every opening.
check('the screenshots the recording already owns are NOT rescanned',
      !found.includes('0001.png'), found.join(', '));
check('nor the originals it has already taken in',
      !found.includes('DSC_0001.jpg'), found.join(', '));

check('the order is settled, not whatever the file system says',
      found.join() === [...found].sort().join(), found.join(', '));
check('a folder that is not there answers with nothing rather than throwing',
      Array.isArray(photos.waiting(path.join(dir, 'nope'))));

console.log('\nwhat counts as a photograph:');
check('a JPEG does', photos.looksLikeAPhoto('a.jpg') && photos.looksLikeAPhoto('a.JPEG'));
check('a PNG does', photos.looksLikeAPhoto('a.png'));
check('a text file does not', !photos.looksLikeAPhoto('a.txt'));
check('a file with no extension does not', !photos.looksLikeAPhoto('README'));
// Counted as a photo so that the person is TOLD, rather than having it ignored
// in silence - it is what an iPhone writes by default.
check('a HEIC counts, so it can be reported rather than skipped quietly',
      photos.looksLikeAPhoto('IMG_0001.heic'));

console.log('\nand what it says about the ones it cannot read:');
const heic = photos.convert(path.join(dir, 'IMG_0001.heic'));
check('a HEIC is refused', Boolean(heic.error), JSON.stringify(heic));
check('by name, so the person knows which file', heic.error.includes('IMG_0001.heic'));
check('and told what to do about it', /JPEG/.test(heic.error), heic.error);
const txt = photos.convert(path.join(dir, 'notes.txt'));
check('something that is not an image at all is refused too', Boolean(txt.error));
check('and neither throws', true);

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
