/**
 * The LaTeX export as one zip.
 *
 * Every other export is a file. This one cannot be: `\includegraphics` names a
 * file and LaTeX has no embedded picture, so the pictures travel in a folder -
 * and watching that go into Overleaf turned up the rule nobody is told, that
 * the folder's name is part of the paths inside the document. A zip carries
 * both and removes the rule.
 *
 * So what is checked here is the join: that every path the document asks for is
 * a file the zip actually contains. That failure is silent in LaTeX - a path
 * naming nothing sets an empty box, no error, and a reader gets a guide with
 * holes in it.
 */
const path = require('node:path');
const { buildZip, missingFrom } = require('../ui/src/main/texzip');
const { buildLatex } = require('../ui/src/main/latex');
// Resolved from the app's own folder: it is the app's dependency, not the
// suite's, and the suite has no node_modules of its own.
const JSZip = require(path.join(__dirname, '..', 'ui', 'node_modules', 'jszip'));

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log('  PASS ' + n); return; }
  fail++;
  console.log('  FAIL ' + n + (extra ? `\n        ${extra}` : ''));
};

const B = String.fromCharCode(92);
const session = {
  steps: [
    { id: '1', action: 'leftClick', text: 'Clicked "Save"', screenshot: 'steps/0001.png',
      window: { title: 'App', process: 'app.exe' } },
    { id: '2', action: 'leftClick', text: 'Clicked "Close"', screenshot: 'steps/0002.png',
      window: { title: 'App', process: 'app.exe' } },
  ],
};

const imageDir = 'halifax-images';
const images = new Map([
  ['0001.png', Buffer.from('first picture')],
  ['0002.png', Buffer.from('second picture')],
]);

const tex = buildLatex(session, {
  title: 'Halifax survey',
  standalone: true,
  imageDir,
  imageRef: (step) => (step.screenshot
    ? `${imageDir}/${path.basename(step.screenshot)}`
    : null),
});

(async () => {
  console.log('what the document asks for is what the zip holds:');
  check('nothing is missing when the pictures are all there',
        missingFrom(tex, imageDir, images.keys()).length === 0);

  // The failure this exists to catch, made on purpose.
  const short = new Map([['0001.png', Buffer.from('first picture')]]);
  const gone = missingFrom(tex, imageDir, short.keys());
  check('a picture the document names and the export lacks is found',
        gone.length === 1 && gone[0] === `${imageDir}/0002.png`, gone.join(', '));
  check('and a folder renamed underneath the paths is caught too',
        missingFrom(tex, 'renamed-images', images.keys()).length === 2);

  console.log('\nthe zip:');
  const bytes = await buildZip({ tex, texName: 'halifax.tex', imageDir, images });
  check('is bytes, not a promise of them', Buffer.isBuffer(bytes) && bytes.length > 0);

  const back = await JSZip.loadAsync(bytes);
  const entries = Object.keys(back.files).filter((n) => !back.files[n].dir).sort();
  check('holds the document and every picture, and nothing else',
        entries.length === 3
        && entries.includes('halifax.tex')
        && entries.includes(`${imageDir}/0001.png`)
        && entries.includes(`${imageDir}/0002.png`),
        entries.join(', '));

  const inside = await back.file('halifax.tex').async('string');
  check('the document inside is the one that compiles on its own',
        inside.includes(B + 'documentclass') && inside.includes(B + 'end{document}'));
  check('and its picture paths point into the folder that is in the zip',
        inside.includes(`{${imageDir}/0001.png}`));

  const picture = await back.file(`${imageDir}/0002.png`).async('nodebuffer');
  check('a picture comes back out byte for byte',
        picture.equals(images.get('0002.png')), `${picture.length} bytes`);

  // Two steps sharing one screenshot is one file in the folder and two
  // references to it, which must not become two entries or a missing one.
  const shared = buildLatex(session, {
    title: 'Halifax survey', standalone: true, imageDir,
    imageRef: () => `${imageDir}/0001.png`,
  });
  const sharedZip = await JSZip.loadAsync(await buildZip({
    tex: shared, texName: 'halifax.tex', imageDir,
    images: new Map([['0001.png', Buffer.from('first picture')]]),
  }));
  check('a screenshot two steps share is one file in the zip',
        Object.keys(sharedZip.files).filter((n) => !sharedZip.files[n].dir).length === 2);
  check('and nothing is reported missing for it',
        missingFrom(shared, imageDir, ['0001.png']).length === 0);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
