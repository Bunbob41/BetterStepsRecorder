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

  // Every export containing a screenshot was invalid, and nothing noticed:
  // the checks here confirmed a zip holding images and stopped there, which a
  // broken export passes just as happily. Word said only "error trying to open
  // the file", naming nothing. A picture arrives as drawing XML using a:, pic:,
  // wp: and a14:; the template declared w: and r: alone, because the template
  // itself is nothing but paragraphs - so those prefixes were unbound the
  // moment an image was inserted.
  {
    const root = xml.match(/<w:document[^>]*>/)[0];
    const declared = new Set([...root.matchAll(/xmlns:(\w+)=/g)].map((m) => m[1]));
    const used = new Set([...xml.matchAll(/<\/?(\w+):/g)].map((m) => m[1]));
    const undeclared = [...used].filter((u) => !declared.has(u));
    check('every namespace prefix used is declared', undeclared.length === 0);
    if (undeclared.length) console.log('    undeclared: ' + undeclared.join(', '));
    check('an image really was inserted, so this test can fail',
          used.has('pic') || used.has('a'));
  }
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

  // --- and again with headings, through the real template -------------------
  //
  // Rendered, not just built: the data being right says nothing about whether
  // Word gets a heading or another bold line of body text, and the paragraph
  // text has to be read out of the runs because Word splits a typed string
  // across several of them.
  console.log('\nheadings, rendered:');
  {
    const withHeadings = { dir, name: 'Provisioning', steps: [
      { id: 'h1', action: 'section', text: 'Raise the request', textEdited: true },
      session.steps[0],
      { id: 'h2', action: 'section', text: 'Approve it', textEdited: true },
      session.steps[2],
      { id: 'h3', action: 'section', text: 'Phase that was cut', textEdited: true },
      { id: 'z', action: 'leftClick', text: 'Click Delete', excluded: true,
        window: win('CRM', 'chrome.exe'), screenshot: 'steps/0001.png' },
    ] };

    const r = await render(tpl, withHeadings, {
      title: 'Provisioning', brand: null, redactionSummary: '' });
    const z2 = await JSZip.loadAsync(r.buffer);
    const x2 = await z2.file('word/document.xml').async('string');

    // Paragraph by paragraph, carrying the style, which is the only way to tell
    // a heading from a bold line.
    const rows = [...x2.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((m) => ({
      style: (m[0].match(/w:pStyle w:val="([^"]+)"/) || [])[1] || '',
      text: [...m[0].matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)].map((t) => t[1]).join(''),
    }));
    const find = (t) => rows.find((r2) => r2.text === t);

    check('the heading reaches the document', Boolean(find('Raise the request')));
    check('as a heading, not another bold line of body text',
          find('Raise the request').style === 'Heading3');
    check('and the style it names is defined in the file',
          (await z2.file('word/styles.xml').async('string')).includes('"Heading3"'));

    check('a heading whose only step was excluded is gone',
          !find('Phase that was cut'));

    // The reason numbering is continuous: "I am stuck on step 2" has to mean
    // the second step of the procedure, not the second step of some phase.
    //
    // Read as "the paragraph after this heading" rather than by scanning for
    // anything that starts with a digit: this template's own boilerplate has
    // headings called "1. CONTEXT" and "3. CONSISTENCY", and counting those
    // measures the template rather than the recording.
    const after = (t) => rows[rows.findIndex((r2) => r2.text === t) + 1].text;
    check('the first phase begins at step 1', after('Raise the request').startsWith('1. '));
    check('and the next carries on from there rather than restarting',
          after('Approve it').startsWith('2. '));
    check('a heading takes no step number', !/^\d+\. /.test(find('Approve it').text));

    check('every namespace prefix used is still declared', (() => {
      const root = x2.match(/<w:document[^>]*>/)[0];
      const declared = new Set([...root.matchAll(/xmlns:(\w+)=/g)].map((m) => m[1]));
      return [...new Set([...x2.matchAll(/<\/?(\w+):/g)].map((m) => m[1]))]
        .every((u) => declared.has(u));
    })());
    check('no loop or condition marker survived',
          !/\{\{|END-FOR|END-IF/.test(x2));
  }

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

console.log('\nheadings in the Word data:');
{
  const sectioned = {
    dir,
    name: 'Provisioning',
    steps: [
      { id: 'h1', action: 'section', text: 'Raise the request', textEdited: true },
      session.steps[0],
      { id: 'h2', action: 'section', text: 'Approve it', textEdited: true },
      session.steps[2],
      { id: 'h3', action: 'section', text: 'Orphan', textEdited: true },
    ],
  };

  const data = buildData(sectioned, { title: 'T' });
  const head = data.steps.find((r) => r.description === 'Raise the request');

  check('a heading is flagged for the template to branch on', head.isSection);
  check('and counts as written, so it takes no number', head.isNote && head.number === '');
  check('its text is left exactly as the author wrote it',
        head.description === 'Raise the request');

  const first = data.steps.find((r) => r.number === '1');
  check('a step says which phase it is in', first.section === 'Raise the request');
  check('and is not itself a heading', first.isSection === false);

  check('the step count is of steps, not rows', data.step_count === '2');
  check('a heading with nothing under it is dropped',
        !data.steps.some((r) => r.description === 'Orphan'));

  // Numbering runs through the phases: four rows, two of them numbered 1 and 2.
  check('numbering runs through the phases, not restarting',
        data.steps.filter((r) => r.number).map((r) => r.number).join() === '1,2');

  const flat = buildData(session, { title: 'T' });
  check('a guide without headings leaves the phase blank',
        flat.steps.every((r) => r.section === ''));
  check('and flags nothing as a heading', flat.steps.every((r) => !r.isSection));
}

console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
