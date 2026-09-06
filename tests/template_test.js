/**
 * The template engine. The property that matters most: the organisation's file
 * is a spine we read and never rewrite, and anything we do not understand is
 * left exactly as found rather than quietly dropped.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { render, inspect, copyImages, redactionSummary } = require('../ui/src/main/template');

const dir = path.join(os.tmpdir(), 'bsr-tpl-' + Date.now());
fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
for (const n of ['0001', '0002', '0003']) {
  fs.writeFileSync(path.join(dir, 'steps', `${n}.png`), PNG);
}

const win = (t, p) => ({ title: t, process: p, rect: { x: 0, y: 0, w: 10, h: 10 } });
const session = {
  dir,
  name: 'User Provisioning Process',
  steps: [
    { id: 'a', action: 'leftClick', text: 'Click the "New User" button',
      window: win('Salesforce', 'chrome.exe'), screenshot: 'steps/0001.png' },
    { id: 'n', action: 'note', text: 'Check the request ticket before continuing.' },
    { id: 'b', action: 'keyText', text: 'Type the corporate email address',
      typed: 'j.doe@corporate.com', window: win('Salesforce', 'chrome.exe'),
      screenshot: 'steps/0002.png' },
    { id: 'c', action: 'password', text: 'Entered password',
      window: win('Salesforce', 'chrome.exe'), screenshot: 'steps/0003.png' },
    { id: 'd', action: 'leftClick', text: 'Excluded step', excluded: true,
      window: win('Salesforce', 'chrome.exe'), screenshot: 'steps/0001.png' },
  ],
};

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

const tplPath = path.join(__dirname, '..', 'templates', 'corporate-sop.md');
const tpl = fs.readFileSync(tplPath, 'utf8');
const before = fs.statSync(tplPath).mtimeMs;

console.log('inspecting the shipped corporate template:');
const info = inspect(tpl);
check('finds its hooks', info.hooks.length >= 8);
check('finds both repeating blocks', info.loops.length === 2);
check('reports no unpaired loop markers', info.unpaired.length === 0);

console.log('\nrendering:');
const { text, report } = render(tpl, session, { title: 'User Provisioning', imageDir: 'img' });

check('the template file itself is untouched', fs.statSync(tplPath).mtimeMs === before);
check('title injected', text.includes('**SOP Name:** User Provisioning'));
check('document id generated', /\*\*Document ID:\*\* SOP-\d{8}-[0-9A-F]{4}/.test(text));
check('target application derived from the steps', text.includes('chrome.exe'));
check('step count counts steps, not notes', text.includes('3 steps') || text.includes('| 3 '));
check('no hook comments survive for filled values', !text.includes('INJECT_TITLE'));

console.log('\nthe steps loop:');
check('uses the row template from the file, not a built-in one',
      report.loops.some((l) => l.hook === 'START_DYNAMIC_STEPS_LOOP' && l.usedTemplateBody));
check('renders each included step', text.includes('Click the &quot;New User&quot;') ||
      text.includes('Click the "New User" button'));
check('excluded steps never reach the document', !text.includes('Excluded step'));
check('notes appear without a number', text.includes('Check the request ticket'));
check('numbering skips notes',
      text.includes('**1. Click the "New User" button**') &&
      text.includes('**2. Type the corporate email address**'));
check('a note carries no number and no stray punctuation',
      text.includes('**Check the request ticket before continuing.**'));
check('images referenced relatively', text.includes('](img/0001.png)'));

console.log('\ncompliance section:');
check('reports the password step truthfully',
      /1 password entry recorded without their contents/.test(text));
check('does not claim blurring that never happened',
      /no screenshot regions were blurred/.test(text));
check('mentions the excluded step', /1 step\(s\) were excluded/.test(text));

const blurred = { ...session, steps: session.steps.map((s) =>
  s.id === 'a' ? { ...s, redacted: true } : s) };
check('reports blurring when it did happen',
      /1 screenshot\(s\) had regions blurred/.test(redactionSummary(blurred.steps)));

console.log('\nunknown and malformed hooks:');
const odd = 'A <!-- PARSER_HOOK: INJECT_TITLE --> B <!-- PARSER_HOOK: INJECT_NONSENSE --> C';
const r2 = render(odd, session, { title: 'T' });
check('unknown hooks are left exactly as found', r2.text.includes('INJECT_NONSENSE'));
check('and are reported', r2.report.unknown.includes('INJECT_NONSENSE'));
check('known hooks around them still fill', r2.text.includes('A T B'));

const noBody = '<!-- PARSER_HOOK: START_STEPS -->\nprose only\n<!-- PARSER_HOOK: END_STEPS -->';
const r3 = render(noBody, session, { title: 'T', imageDir: 'img' });
check('a loop with no placeholders falls back to a default row',
      r3.text.includes('1. Click the "New User" button'));
check('and says it did not use the file body',
      r3.report.loops.some((l) => l.usedTemplateBody === false));

console.log('\nvoice - what the recording was FOR:');
{
  // Its own steps, worded the way the ENGINE words them. The fixtures above are
  // already imperative, so the transform was a no-op on them in either
  // direction - which is exactly why these tests watched a template export
  // ignore the voice entirely and reported nothing wrong.
  const recorded = { dir: '/tmp/x', steps: [
    { id: 'p', action: 'leftClick', text: 'Clicked the "Save" button in "Billing"' },
    { id: 'q', action: 'keyText', text: 'Typed "ACME Ltd" into the Customer field' },
    { id: 'r', action: 'keyPress', text: 'Pressed Enter in "Billing"' },
    { id: 'm', action: 'leftClick', text: 'Nudge the slider until it clicks',
      textEdited: true },
  ] };
  const body = '<!-- PARSER_HOOK: START_STEPS -->{{description}}\n'
             + '<!-- PARSER_HOOK: END_STEPS -->';

  const proc = render(body, recorded, { title: 'T', imageDir: 'img',
                                        voice: 'imperative' }).text;
  check('a procedure tells the reader what to do',
        proc.includes('Click the "Save" button in "Billing"'));
  check('typing too', proc.includes('Type "ACME Ltd" into the Customer field'));
  check('and key presses', proc.includes('Press Enter in "Billing"'));
  check('it does not narrate what was done', !proc.includes('Clicked the "Save"'));

  const evidence = render(body, recorded, { title: 'T', imageDir: 'img',
                                            voice: 'past' }).text;
  check('an evidence record states what was done',
        evidence.includes('Clicked the "Save" button in "Billing"'));
  check('so the two are different documents', evidence !== proc);

  check('wording the author rewrote is left alone in both',
        proc.includes('Nudge the slider until it clicks')
        && evidence.includes('Nudge the slider until it clicks'));

  const bare = render(body, recorded, { title: 'T', imageDir: 'img' }).text;
  check('and the default is instructions', bare.includes('Click the "Save"'));
}

console.log('\nimages:');
check('only included steps are copied', copyImages(session, path.join(dir, 'out')) === 3);

fs.rmSync(dir, { recursive: true, force: true });
console.log('\nheadings through a template:');
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

  const tpl = [
    '<!-- PARSER_HOOK: INJECT_STEP_COUNT -->',
    '<!-- PARSER_HOOK: START_STEPS -->',
    '[{{is_section}}|{{section}}|{{number_prefix}}{{description}}]',
    '<!-- PARSER_HOOK: END_STEPS -->',
  ].join('\n');

  const { text } = render(tpl, sectioned, { title: 'T' });

  check('a heading is flagged so a template can style it',
        text.includes('[true|Raise the request|Raise the request]'));
  check('and carries no number', !/\[true\|[^|]*\|\d/.test(text));
  check('a step says which phase it is in',
        text.includes('[false|Raise the request|1. Click the "New User" button]'));
  check('the next phase renames it', text.includes('|Approve it|2. '));

  // The count a template prints must be of steps, not of rows.
  check('the step count ignores headings', text.includes('2'));
  check('a heading with nothing under it never reaches the template',
        !text.includes('Orphan'));

  // A recording with no headings must leave the new variables empty rather
  // than absent, so an existing template does not start printing "{{section}}".
  const { text: flat } = render(tpl, session, { title: 'T' });
  check('a guide without headings leaves the phase blank',
        flat.includes('[false||1. '));
}

console.log('\nthe ready-made row text, for a format with no conditionals:');
{
  const rows = {
    dir,
    name: 'P',
    steps: [
      { id: 'h', action: 'section', text: 'Raise the request', textEdited: true },
      session.steps[0],
      { id: 'n2', action: 'note', text: 'Wait for the batch.' },
    ],
  };

  const tpl = ['<!-- PARSER_HOOK: START_STEPS -->',
               '{{checkbox}}{{text_block}}',
               '<!-- PARSER_HOOK: END_STEPS -->'].join('\n');
  const { text } = render(tpl, rows, { title: 'T' });
  const lines = text.split('\n').filter(Boolean);

  // The whole point: a heading must not come out as another bold line, which
  // is what every template produced before this existed.
  check('a heading is a Markdown heading', lines[0] === '### Raise the request');
  check('and carries no tick box', !lines[0].startsWith('- [ ]'));

  check('a step is a numbered, emphasised line',
        lines[1] === '- [ ] **1. Click the "New User" button**');
  check('a note keeps the emphasis it has always had',
        lines[2] === '**Wait for the batch.**');

  // The window tracker advances on every call. Asking it once per field would
  // give description and text_block two different strings for one step.
  const both = ['<!-- PARSER_HOOK: START_STEPS -->',
                '{{description}}|{{text_block}}',
                '<!-- PARSER_HOOK: END_STEPS -->'].join('\n');
  const pairs = render(both, session, { title: 'T' }).text
    .split('\n').filter((l) => l.includes('|'))
    .map((l) => l.split('|'));
  check('the description is the same however it is asked for',
        pairs.every(([d, b]) => b === d || b.includes(d)));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
