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

console.log('\nimages:');
check('only included steps are copied', copyImages(session, path.join(dir, 'out')) === 3);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
