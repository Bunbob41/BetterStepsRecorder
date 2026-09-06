/**
 * Word template rendering. The checks that matter: the template file is not
 * modified, screenshots are embedded rather than linked, notes carry no
 * number, and nothing is left holding a placeholder.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require(path.join(__dirname, '..', 'ui', 'node_modules', 'jszip'));
const { render, inspect, buildData } = require('../ui/src/main/docx');

const dir = path.join(os.tmpdir(), 'bsr-docx-' + Date.now());
fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
for (const n of ['0001', '0002']) fs.writeFileSync(path.join(dir, 'steps', `${n}.png`), PNG);

const win = (t, p) => ({ title: t, process: p, rect: { x: 0, y: 0, w: 10, h: 10 } });
const session = {
  dir,
  name: 'Provisioning',
  steps: [
    { id: 'a', action: 'leftClick', text: 'Click New User',
      window: win('CRM', 'chrome.exe'), screenshot: 'steps/0001.png' },
    { id: 'n', action: 'note', text: 'Check the ticket first.' },
    { id: 'b', action: 'password', text: 'Entered password',
      window: win('CRM', 'chrome.exe'), screenshot: 'steps/0002.png' },
    { id: 'x', action: 'leftClick', text: 'Held back', excluded: true,
      window: win('CRM', 'chrome.exe'), screenshot: 'steps/0001.png' },
    { id: 'g', action: 'leftClick', text: 'Step whose screenshot vanished',
      window: win('CRM', 'chrome.exe'), screenshot: 'steps/gone.png' },
  ],
};

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const tpl = path.join(__dirname, '..', 'templates', 'corporate-sop.docx');

(async () => {
  console.log('the shipped Word template:');
  const info = await inspect(tpl);
  check('is readable as a docx', info.readable);
  check('declares its value placeholders', info.hooks.includes('title'));
  check('declares a repeating block', info.loops.length === 1);
  check('declares an image slot', info.images === 1);

  console.log('\ndata shaping:');
  const d = buildData(session, { title: 'T', brand: null, redactionSummary: 'none' });
  check('excluded steps are dropped', d.steps.length === 4);
  check('notes are not numbered', d.steps.find((s) => s.isNote).label === '');
  check('steps are numbered around notes',
        d.steps[0].label === '1. ' && d.steps[2].label === '2. ');
  check('step count ignores notes', d.step_count === '3');
  check('target application derived', d.target_app === 'chrome.exe');

  console.log('\nrendering:');
  const before = fs.statSync(tpl).mtimeMs;
  const { buffer, missing } = await render(tpl, session, {
    title: 'User Provisioning', brand: { name: 'Acme', footer: 'Confidential' },
    redactionSummary: '1 password entry recorded without their contents.',
  });
  check('the template file is untouched', fs.statSync(tpl).mtimeMs === before);
  check('a missing screenshot is reported, not fatal', missing.length === 1);

  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml').async('string');
  const paras = [...xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) =>
    [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(''));
  const text = paras.join('\n');

  check('is a valid zip with the expected parts',
        Boolean(zip.file('[Content_Types].xml') && zip.file('word/document.xml')));
  // Exclude the folder entry itself, which JSZip lists alongside the files.
  const media = Object.keys(zip.files)
    .filter((f) => f.startsWith('word/media/') && !zip.files[f].dir);
  check('screenshots are embedded, not linked', media.length > 0);
  check(`one image per step that had one (${media.length})`, media.length === 2);
  check('title injected', text.includes('User Provisioning'));
  check('organisation injected', text.includes('Acme'));
  check('footer injected', text.includes('Confidential'));
  check('compliance line injected', text.includes('1 password entry recorded'));
  check('numbered step present', text.includes('1. Click New User'));
  check('note present without a number', text.includes('Check the ticket first.'));
  check('no stray dot before the note', !text.includes('. Check the ticket first.'));
  check('excluded step absent', !text.includes('Held back'));
  check('no placeholder survived', !text.includes('{{'));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('\nvoice:');
{
  // Worded as the engine words it; the fixture above is already imperative and
  // so could never have shown this up. Word had no notion of voice at all, so
  // the format most likely to reach a company read as a diary entry.
  const recorded = { dir, steps: [
    { id: 'p', action: 'leftClick', text: 'Clicked the "Save" button' },
    { id: 'e', action: 'leftClick', text: 'Slide it right', textEdited: true },
  ] };
  const first = (o) => buildData(recorded, { title: 'T', brand: null,
                                             redactionSummary: '', ...o })
                       .steps[0].description;

  check('a procedure is written as instructions',
        first({ voice: 'imperative' }) === 'Click the "Save" button');
  check('an evidence record stays in the past tense',
        first({ voice: 'past' }) === 'Clicked the "Save" button');
  check('so the two differ', first({ voice: 'imperative' }) !== first({ voice: 'past' }));
  check('the default is instructions', first({}) === 'Click the "Save" button');
  check('wording the author rewrote is untouched either way',
        buildData(recorded, { title: 'T', brand: null, redactionSummary: '',
                              voice: 'imperative' }).steps[1].description
        === 'Slide it right');
}

console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
