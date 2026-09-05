/**
 * The template library shown before recording. The property that matters: a
 * system default is always offered, so someone with no format of their own
 * still starts on something complete.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { list, defaultFor, userDir } = require('../ui/src/main/templates-lib');

const fakeUserData = path.join(os.tmpdir(), 'bsr-tpl-lib-' + Date.now());
fs.mkdirSync(fakeUserData, { recursive: true });
const projectRoot = path.join(__dirname, '..');

let pass = 0, fail = 0;
const check = (n, c) => { c ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

console.log('with no templates of your own:');
const a = list(projectRoot, fakeUserData);
check('the built-ins are found', a.templates.length >= 2);
check('a system default is offered', a.templates.some((t) => t.isDefault));
check('the default is listed first', a.templates[0].isDefault === true);
check('it is named for what it is, not its filename',
      a.templates[0].name.startsWith('System default'));
check('Word and Markdown defaults are distinguished',
      a.templates.filter((t) => t.isDefault).map((t) => t.kind).sort().join() === 'Markdown,Word');
check('a user templates folder is created', fs.existsSync(a.userDir));

console.log('\nafter dropping in your own:');
fs.writeFileSync(path.join(userDir(fakeUserData), 'acme-work-instruction.md'), '# Acme');
fs.writeFileSync(path.join(userDir(fakeUserData), 'notes.rtf'), 'ignored');
const b = list(projectRoot, fakeUserData);
check('your template appears', b.templates.some((t) => t.origin === 'user'));
check('it is named readably',
      b.templates.find((t) => t.origin === 'user').name === 'acme work instruction');
check('unsupported files are ignored', !b.templates.some((t) => t.path.endsWith('.rtf')));
check('yours come after the built-ins',
      b.templates.findIndex((t) => t.origin === 'user') >= 2);

console.log('\nchoosing a default:');
check('prefers the Word system default',
      defaultFor(projectRoot, fakeUserData).endsWith('.docx'));
const mine = path.join(userDir(fakeUserData), 'acme-work-instruction.md');
check('an explicit preference wins', defaultFor(projectRoot, fakeUserData, mine) === mine);
check('a preference that no longer exists falls back',
      defaultFor(projectRoot, fakeUserData, '/gone/missing.docx').endsWith('.docx'));

fs.rmSync(fakeUserData, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
