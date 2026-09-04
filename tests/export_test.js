const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildHtml, buildMarkdown, copyImages, toImperative } = require('../ui/src/main/export');

const dir = path.join(os.tmpdir(), 'bsr-export-test-' + Date.now());
fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });

// A 1x1 PNG so the exporters have a real file to embed and copy.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
fs.writeFileSync(path.join(dir, 'steps', '0001.png'), PNG);
fs.writeFileSync(path.join(dir, 'steps', '0002.png'), PNG);

const session = {
  dir,
  steps: [
    { id: 'a', seq: 1, action: 'leftClick', text: 'Clicked the "Save" button in "Billing"',
      point: { x: 150, y: 120 }, window: { title: 'Billing', process: 'app.exe',
      rect: { x: 100, y: 100, w: 200, h: 200 } }, screenshot: 'steps/0001.png' },
    { id: 'b', seq: 2, action: 'keyText', text: 'Typed "ACME" into the "Name" field in "Billing"',
      typed: 'ACME', point: { x: 9999, y: 9999 }, window: { title: 'Billing', process: 'app.exe',
      rect: { x: 100, y: 100, w: 200, h: 200 } }, screenshot: 'steps/0002.png' },
    { id: 'c', seq: 3, action: 'leftClick', text: 'Approve it & <check> the "total"',
      textEdited: true, point: { x: 150, y: 120 }, window: { title: 'Billing', process: 'app.exe',
      rect: { x: 100, y: 100, w: 200, h: 200 } }, screenshot: 'steps/nope.png' },
  ],
};

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

console.log('imperative voice:');
check('Clicked -> Click', toImperative(session.steps[0]).startsWith('Click the'));
check('Typed -> Type', toImperative(session.steps[1]).startsWith('Type '));
check('user-edited wording is left verbatim',
      toImperative(session.steps[2]) === 'Approve it & <check> the "total"');
check('Pressed -> Press', toImperative({ text: 'Pressed Ctrl+S' }) === 'Press Ctrl+S');
check('password phrasing reads as an instruction',
      toImperative({ text: 'Entered password in "Billing"' }).startsWith('Enter your password'));

console.log('\nHTML:');
const html = buildHtml(session, { title: 'How to <bill> & invoice', embedImages: true });
check('title is escaped', html.includes('How to &lt;bill&gt; &amp; invoice'));
check('user text is escaped', html.includes('Approve it &amp; &lt;check&gt;'));
check('no raw unescaped angle bracket from step text', !html.includes('<check>'));
check('images are embedded, not linked', html.includes('data:image/png;base64,'));
check('no file paths leak into the document', !html.includes('steps/0001.png'));
check('missing screenshot is skipped, not broken', !html.includes('nope.png'));
check('marker rendered for an in-frame click', html.includes('class="marker"'));

// Only step a qualifies: b's point is far outside the window rect, and c has
// no screenshot at all.
const markers = (html.match(/class="marker"/g) || []).length;
check('marker omitted when the point is outside the frame', markers === 1);
check('step count reported', html.includes('3 steps'));
check('dark mode handled', html.includes('prefers-color-scheme: dark'));
check('print rules avoid splitting a step', html.includes('page-break-inside: avoid'));

console.log('\nMarkdown:');
const md = buildMarkdown(session, { title: 'Invoicing', imageDir: 'invoicing-images' });
check('has a title heading', md.startsWith('# Invoicing'));
check('steps are numbered headings', md.includes('## 1. Click the "Save" button'));
check('images use relative paths', md.includes('![Step 1](invoicing-images/0001.png)'));
check('missing screenshot omitted', !md.includes('nope.png'));

const imgDir = path.join(dir, 'out-images');
check('copyImages copies only what exists', copyImages(session, imgDir) === 2);
check('copied files land in place', fs.readdirSync(imgDir).length === 2);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
