const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildHtml, buildMarkdown, copyImages, toImperative, exportable } = require('../ui/src/main/export');

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
check('marker rendered for an in-frame click', html.includes('class="bsr-marker'));

// Only step a qualifies: b's point is far outside the window rect, and c has
// no screenshot at all.
const markers = (html.match(/class="bsr-marker/g) || []).length;
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


console.log('');
console.log('notes, exclusion and framing:');

fs.writeFileSync(path.join(dir, 'steps', '0003.png'), PNG);
const rect = { x: 100, y: 100, w: 200, h: 200 };
const mkStep = (id, over) => ({ id, seq: 1, action: 'leftClick', text: `Clicked ${id}`,
  point: { x: 150, y: 120 }, window: { title: 'Billing', process: 'app.exe', rect },
  screenshot: 'steps/0001.png', ...over });

const mixed = { dir, steps: [
  mkStep('a'),
  { id: 'n1', action: 'note', text: 'Wait for the overnight batch to finish', textEdited: true },
  mkStep('b'),
  mkStep('c', { excluded: true, screenshot: 'steps/0003.png' }),
]};

check('exportable drops excluded steps', exportable(mixed).length === 3);

const h2 = buildHtml(mixed, { title: 'Mixed', embedImages: true });
check('an excluded step does not appear', !h2.includes('Click c'));
check('a note appears verbatim', h2.includes('Wait for the overnight batch to finish'));
check('a note is styled as an aside', h2.includes('class="step note"'));
check('notes do not consume step numbers',
      h2.includes('>1</span>') && h2.includes('>2</span>') && !h2.includes('>3</span>'));
check('the count excludes notes and excluded steps', h2.includes('2 steps'));

const m2 = buildMarkdown(mixed, { title: 'Mixed', imageDir: 'img' });
check('markdown renders a note as a quote', m2.includes('> Wait for the overnight batch'));
check('markdown numbering skips notes',
      m2.includes('## 1.') && m2.includes('## 2.') && !m2.includes('## 3.'));
check('markdown omits excluded steps', !m2.includes('Click c'));
check('copyImages skips excluded steps',
      copyImages(mixed, path.join(dir, 'excluded-images')) === 2);

// Framing: with a monitor-sized frame the marker must be placed against the
// frame, or it lands in the wrong part of a much larger image.
const framed = { dir, steps: [ mkStep('f', {
  frame: { x: 0, y: 0, w: 1000, h: 1000 }, point: { x: 500, y: 250 } }) ]};
check('marker uses the captured frame when present',
      buildHtml(framed, { title: 'F', embedImages: true }).includes('left:50.00%'));

const windowOnly = { dir, steps: [ mkStep('w', { point: { x: 150, y: 150 } }) ]};
check('marker falls back to the window rect when no frame was recorded',
      buildHtml(windowOnly, { title: 'W', embedImages: true }).includes('left:25.00%'));


console.log('');
console.log('branding:');

const logo = path.join(dir, 'logo.png');
fs.writeFileSync(logo, PNG);
const brand = { name: 'Acme & Co <Finance>', logo, footer: 'Internal use only' };

const hb = buildHtml(session, { title: 'Branded', embedImages: true, brand });
check('organisation name appears', hb.includes('Acme &amp; Co &lt;Finance&gt;'));
check('brand name is escaped, not injected', !hb.includes('<Finance>'));
check('the logo is embedded', hb.includes('class="logo"') && hb.includes('data:image/png;base64,'));
check('the footer appears', hb.includes('Internal use only'));

const noBrand = buildHtml(session, { title: 'Plain', embedImages: true });
check('without branding there is no logo', !noBrand.includes('class="logo"'));
check('without branding the document still renders', noBrand.includes('Plain'));

const missing = buildHtml(session, { title: 'X', embedImages: true,
  brand: { name: 'N', logo: path.join(dir, 'nope.png'), footer: '' } });
check('a missing logo file does not break the export', missing.includes('>N<'));

const mb = buildMarkdown(session, { title: 'Branded', imageDir: 'img', brand });
check('markdown carries the organisation', mb.includes('*Acme & Co <Finance>*'));
check('markdown carries the footer', mb.includes('Internal use only'));


console.log('');
console.log('voice, decided before recording:');

const record = { dir, steps: [
  { id: 'v', action: 'leftClick', text: 'Clicked the "Save" button in "Billing"',
    point: { x: 150, y: 120 },
    window: { title: 'Billing', process: 'app.exe', rect: { x: 100, y: 100, w: 200, h: 200 } },
    screenshot: 'steps/0001.png' },
]};

const asProcedure = buildHtml(record, { title: 'P', embedImages: true });
check('a procedure tells the reader what to do',
      asProcedure.includes('Click the &quot;Save&quot; button'));

const asEvidence = buildHtml(record, { title: 'E', embedImages: true, voice: 'past' });
check('an evidence record states what was done',
      asEvidence.includes('Clicked the &quot;Save&quot; button'));
check('and is not rewritten into an instruction',
      !asEvidence.includes('>Click the'));

const mdEvidence = buildMarkdown(record, { title: 'E', imageDir: 'i', voice: 'past' });
check('markdown honours the same choice', mdEvidence.includes('## 1. Clicked the'));

check('hand-written wording is untouched either way',
      buildHtml({ dir, steps: [{ id: 'e', action: 'note',
        text: 'Approve it', textEdited: true }] }, { title: 'X' }).includes('Approve it'));

fs.rmSync(dir, { recursive: true, force: true });
console.log('\nthe window is worth saying once:');
{
  const { windowTracker } = require('../ui/src/main/export');
  const inWin = (t, title) => ({ action: 'leftClick', text: t,
                                 window: { title, process: 'x.exe' } });

  const d = windowTracker();
  const a = d(inWin('Clicked the "Save" button in "Billing"', 'Billing'), 'imperative');
  const b = d(inWin('Clicked the "New" button in "Billing"', 'Billing'), 'imperative');
  const c = d(inWin('Clicked the "OK" button in "Settings"', 'Settings'), 'imperative');
  const e = d(inWin('Clicked the "Back" link in "Settings"', 'Settings'), 'imperative');

  check('the first step in a window names it', a.endsWith('in "Billing"'));
  check('the next one in the same window does not',
        b === 'Click the "New" button');
  check('a new window is named again', c.endsWith('in "Settings"'));
  check('and then dropped again', e === 'Click the "Back" link');

  // 69% of one recording's description text was this repetition.
  const long = 'Rocket League (64-bit, DX11, Cooked)';
  const t = windowTracker();
  const first = t(inWin(`Clicked in "${long}"`, long), 'imperative');
  const rest = [...Array(5)].map(() => t(inWin(`Clicked in "${long}"`, long), 'imperative'));
  check('a title repeated six times is written once',
        first.includes(long) && rest.every((x) => !x.includes(long)));
  check('and what remains is still a sentence', rest[0] === 'Click');
}

console.log('\nand only when it really is repetition:');
{
  const { windowTracker } = require('../ui/src/main/export');
  const inWin = (t, title) => ({ action: 'leftClick', text: t,
                                 window: { title, process: 'x.exe' } });

  // A note sits between two steps in the same window. It states no window of
  // its own and must not make the next step repeat one.
  const d = windowTracker();
  d(inWin('Clicked "Save" in "Billing"', 'Billing'), 'imperative');
  const note = d({ action: 'note', text: 'Check the ticket first.' }, 'imperative');
  const after = d(inWin('Clicked "New" in "Billing"', 'Billing'), 'imperative');
  check('a note is left exactly as written', note === 'Check the ticket first.');
  check('and does not reintroduce the window', after === 'Click "New"');

  // The title appearing mid-sentence is part of what was clicked.
  const m = windowTracker();
  m(inWin('Clicked "Billing" in "Billing"', 'Billing'), 'imperative');
  const mid = m(inWin('Clicked the "Billing" tab in "Billing"', 'Billing'), 'imperative');
  check('only the trailing clause is removed', mid === 'Click the "Billing" tab');

  // A step whose window was never resolved is left alone.
  const n = windowTracker();
  check('a step with no window is untouched',
        n({ action: 'leftClick', text: 'Clicked' }, 'imperative') === 'Click');

  // Evidence records keep the past tense AND the same condensing.
  const p = windowTracker();
  p(inWin('Clicked "Save" in "Billing"', 'Billing'), 'past');
  check('past tense condenses too',
        p(inWin('Clicked "New" in "Billing"', 'Billing'), 'past') === 'Clicked "New"');
}

console.log('\nheadings in the finished guide:');
{
  const sectioned = {
    dir,
    steps: [
      { id: 'h1', action: 'section', text: 'Prepare the file', textEdited: true },
      session.steps[0],
      { id: 'h2', action: 'section', text: 'Submit it', textEdited: true },
      session.steps[1],
      { id: 'h3', action: 'section', text: 'Nothing under this', textEdited: true },
    ],
  };

  const html = buildHtml(sectioned, { title: 'T' });

  check('HTML prints the heading', html.includes('<h2>Prepare the file</h2>'));
  check('as a row of the list, not a step',
        html.includes('<li class="section"><h2>'));

  // The reason for one list rather than one per section: someone who says "I am
  // stuck on step 2" must mean the second step of the procedure.
  check('numbering runs through the sections, not restarting at each',
        html.includes('>1</span>') && html.includes('>2</span>')
        && (html.match(/class="num">1</g) || []).length === 1);
  check('the count is of steps, not rows', html.includes('2 steps'));

  // A heading over nothing is a promise the document does not keep.
  check('a heading with nothing under it is dropped',
        !html.includes('Nothing under this'));

  const md = buildMarkdown(sectioned, { title: 'T', imageDir: 'images' });
  check('Markdown prints the heading at h2', md.includes('\n## Prepare the file\n'));
  check('and drops the steps a level beneath it', md.includes('### 1. Click the'));
  check('dropping the empty one too', !md.includes('Nothing under this'));

  // A guide with no headings must read exactly as it did before.
  const flat = buildMarkdown(session, { title: 'T', imageDir: 'images' });
  check('a guide without headings keeps its steps at h2',
        flat.includes('## 1. Click the') && !flat.includes('### 1.'));

  // Excluding every step of a phase has to take the phase with them.
  const emptied = {
    dir,
    steps: [
      { id: 'h1', action: 'section', text: 'Cut entirely', textEdited: true },
      { ...session.steps[0], excluded: true },
      { id: 'h2', action: 'section', text: 'Kept', textEdited: true },
      session.steps[1],
    ],
  };
  const trimmed = buildHtml(emptied, { title: 'T' });
  check('excluding a phase removes its heading', !trimmed.includes('Cut entirely'));
  check('and leaves the phase that still has steps', trimmed.includes('Kept'));

  check('exportable drops it before anything reads the list',
        !exportable(emptied).some((r) => r.text === 'Cut entirely'));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
