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

// 5. deleting a step must not leave its screenshot behind: a step is often
// deleted precisely because the frame showed something it should not.
fs.writeFileSync(path.join(dir, 'steps', 'd.png'), 'fake');
s.addStep(mk('d', 'Clicked d'));
check('delete removes the step', s.removeStep('d') === true);
check('delete removes its screenshot', !fs.existsSync(path.join(dir, 'steps', 'd.png')));
check('deleting an unknown id is a no-op', s.removeStep('nope') === false);

// A screenshot still referenced by another step must survive.
fs.writeFileSync(path.join(dir, 'steps', 'shared.png'), 'fake');
s.addStep({ ...mk('e', 'e'), screenshot: 'steps/shared.png' });
s.addStep({ ...mk('f', 'f'), screenshot: 'steps/shared.png' });
s.removeStep('e');
check('a screenshot shared with another step is kept',
      fs.existsSync(path.join(dir, 'steps', 'shared.png')));


// 6. written steps
const fresh = new Session(path.join(os.tmpdir(), 'bsr-notes-' + Date.now()));
fs.mkdirSync(path.join(fresh.dir, 'steps'), { recursive: true });
fresh.addStep(mk('x', 'Clicked x'));
fresh.addStep(mk('y', 'Clicked y'));

const note = fresh.addNote('Wait for the batch', 'x');
check('note is inserted after the chosen step', fresh.steps[1].id === note.step.id);
check('note keeps the recorded steps around',
      fresh.steps.map((s) => s.id).join() === 'x,' + note.step.id + ',y');
check('note is marked as authored so export leaves it alone', note.step.textEdited === true);
check('note has no screenshot', !note.step.screenshot);
check('note reports its index', note.index === 1);

const appended = fresh.addNote('At the end');
check('a note with no anchor goes last',
      fresh.steps[fresh.steps.length - 1].id === appended.step.id);

// 7. reorder
const beforeOrder = fresh.steps.map((s) => s.id).join();
check('reorder moves a step', fresh.reorder(0, 2) === true);
check('reorder actually changed the order', fresh.steps.map((s) => s.id).join() !== beforeOrder);
check('reorder rejects an out-of-range source', fresh.reorder(99, 0) === false);
check('reorder rejects an out-of-range target', fresh.reorder(0, 99) === false);
check('reorder persists',
      JSON.parse(fs.readFileSync(fresh.metaPath, 'utf8')).steps.length === 4);

// 8. exclusion is a plain flag and must not mark the wording as hand-edited
fresh.updateStep('y', { excluded: true });
check('exclusion is stored', fresh.steps.find((s) => s.id === 'y').excluded === true);
check('excluding does not mark the wording as hand-edited',
      fresh.steps.find((s) => s.id === 'y').textEdited !== true);

fs.rmSync(fresh.dir, { recursive: true, force: true });

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
