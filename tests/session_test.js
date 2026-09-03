const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Session } = require('../ui/src/main/session');

const dir = path.join(os.tmpdir(), 'bsr-session-test-' + Date.now());
const s = new Session(dir);

const mk = (id, text) => ({ id, seq: 0, action: 'leftClick', text,
  point: { x: 1, y: 1 }, screenshot: `steps/${id}.png` });

for (const id of ['a', 'b', 'c']) {
  fs.writeFileSync(path.join(dir, 'steps', `${id}.png`), 'fake');
  s.addStep(mk(id, `Clicked ${id}`));
}

let pass = 0, fail = 0;
const check = (name, cond) => {
  if (cond) { pass++; console.log('  PASS ' + name); }
  else { fail++; console.log('  FAIL ' + name); }
};

// 1. plain replacement keeps position and identity
fs.writeFileSync(path.join(dir, 'steps', 'b2.png'), 'fresh');
s.replaceStep('b', { ...mk('NEW', 'Clicked b again'), screenshot: 'steps/b2.png' });
check('replacement stays at index 1', s.steps[1].id === 'b' && s.steps.length === 3);
check('order preserved', s.steps.map((x) => x.id).join() === 'a,b,c');
check('new screenshot adopted', s.steps[1].screenshot === 'steps/b2.png');
check('regenerated text adopted when user never edited',
      s.steps[1].text === 'Clicked b again');
check('orphaned screenshot deleted', !fs.existsSync(path.join(dir, 'steps', 'b.png')));

// 2. a hand-edited description must survive a re-record
s.updateStep('c', { text: 'Approve the invoice' });
check('editing marks textEdited', s.steps[2].textEdited === true);
fs.writeFileSync(path.join(dir, 'steps', 'c2.png'), 'fresh');
s.replaceStep('c', { ...mk('NEW2', 'Clicked something else'), screenshot: 'steps/c2.png' });
check('hand-written wording survives re-record', s.steps[2].text === 'Approve the invoice');
check('screenshot still refreshed', s.steps[2].screenshot === 'steps/c2.png');
check('rerecordedAt stamped', typeof s.steps[2].rerecordedAt === 'string');

// 3. persistence
const meta = JSON.parse(fs.readFileSync(path.join(dir, 'session.json'), 'utf8'));
check('flushed to disk', meta.steps.length === 3 && meta.steps[2].text === 'Approve the invoice');

// 4. unknown id is a no-op, not a crash
check('unknown id returns null', s.replaceStep('zzz', mk('x', 'y')) === null);

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
