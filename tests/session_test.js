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
const removed = s.removeStep('d');
check('delete reports what it removed', removed && removed.step.id === 'd');
check('delete reports the index it came from', removed.index === s.steps.length);
check('delete removes its screenshot', !fs.existsSync(path.join(dir, 'steps', 'd.png')));
check('deleting an unknown id is a no-op', s.removeStep('nope') === false);
check('a deleted screenshot is stashed for undo', typeof removed.token === 'string');

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

// 6b. sections - a note with a rank, so they share this machinery.
// Its own session: the checks below count the rows in `fresh`.
const withSections = new Session(path.join(os.tmpdir(), 'bsr-sections-' + Date.now()));
fs.mkdirSync(path.join(withSections.dir, 'steps'), { recursive: true });
withSections.addStep(mk('x', 'Clicked x'));
withSections.addStep(mk('y', 'Clicked y'));

const sec = withSections.addSection('Preparation', 'x');
check('a section is inserted after the chosen step',
      withSections.steps[1].id === sec.step.id);
check('a section is authored, so export never rewrites it',
      sec.step.textEdited === true);
check('a section has no screenshot', !sec.step.screenshot);
check('a section is one level, with room to nest later', sec.step.level === 1);
check('a section is distinguishable from a note', sec.step.action === 'section');
check('a section survives a reload',
      JSON.parse(fs.readFileSync(withSections.metaPath, 'utf8'))
        .steps.some((x) => x.action === 'section' && x.text === 'Preparation'));

const lastSec = withSections.addSection('At the end');
check('a section with no anchor goes last',
      withSections.steps[withSections.steps.length - 1].id === lastSec.step.id);

// Renaming and deleting go through the ordinary paths, not special ones: that
// is the whole reason a heading is a row rather than a property of a step.
withSections.updateStep(sec.step.id, { text: 'Get the file ready' });
check('a section is renamed like any other row',
      withSections.steps.find((x) => x.id === sec.step.id).text === 'Get the file ready');
check('and deleted like any other row',
      Boolean(withSections.removeStep(lastSec.step.id))
      && !withSections.steps.some((x) => x.id === lastSec.step.id));

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


// 9. undo support: stash, restore and re-insert
const u = new Session(path.join(os.tmpdir(), 'bsr-undo-' + Date.now()));
fs.mkdirSync(path.join(u.dir, 'steps'), { recursive: true });
fs.writeFileSync(path.join(u.dir, 'steps', 'p.png'), 'original');
u.addStep(mk('p', 'Clicked p'));
u.addStep(mk('q', 'Clicked q'));

const gone = u.removeStep('p');
check('delete stashes the screenshot', typeof gone.token === 'string');
check('the screenshot is gone from its place',
      !fs.existsSync(path.join(u.dir, 'steps', 'p.png')));
check('but it survives in the trash',
      fs.existsSync(path.join(u.dir, '.trash', gone.token)));

check('restore puts the file back', u.restore(gone.token, gone.step.screenshot) === true);
check('the bytes are the original',
      fs.readFileSync(path.join(u.dir, 'steps', 'p.png'), 'utf8') === 'original');
u.insertAt(gone.index, gone.step);
check('the step returns to its original position', u.steps[0].id === 'p');
check('nothing else moved', u.steps.map((s) => s.id).join() === 'p,q');

check('restoring a token that is gone fails safely', u.restore('nope', 'steps/p.png') === false);
check('insertAt clamps an out-of-range index',
      u.insertAt(99, mk('z', 'z')).index === u.steps.length - 1);

// 10. naming
u.rename('Raising an invoice');
check('name is stored', u.name === 'Raising an invoice');
check('name persists', JSON.parse(fs.readFileSync(u.metaPath, 'utf8')).name === 'Raising an invoice');
check('a reloaded session keeps its name', Session.load(u.dir).name === 'Raising an invoice');
check('a long name is trimmed', u.rename('x'.repeat(500)).length === 120);

fs.rmSync(u.dir, { recursive: true, force: true });


// 11. the trash must not outlive the ability to undo. A stashed file is the
// pre-blur original: exactly the pixels the user redacted.
const t = new Session(path.join(os.tmpdir(), 'bsr-trash-' + Date.now()));
fs.mkdirSync(path.join(t.dir, 'steps'), { recursive: true });
fs.writeFileSync(path.join(t.dir, 'steps', 'a.png'), 'secret');
t.addStep(mk('a', 'Clicked a'));

const stashed = t.stash('steps/a.png');
check('stash copies the file aside', fs.existsSync(path.join(t.dir, '.trash', stashed)));
check('the original is untouched by stashing',
      fs.readFileSync(path.join(t.dir, 'steps', 'a.png'), 'utf8') === 'secret');

t.discard(stashed);
check('discard removes one stashed file', !fs.existsSync(path.join(t.dir, '.trash', stashed)));
t.discard('does-not-exist');
check('discarding an unknown token does not throw', true);

const s2 = t.stash('steps/a.png');
const s3 = t.stash('steps/a.png');
check('two stashes of the same file do not collide', s2 !== s3);
check('both exist', fs.existsSync(path.join(t.dir, '.trash', s2))
                  && fs.existsSync(path.join(t.dir, '.trash', s3)));

t.purgeTrash();
check('purgeTrash removes the whole trash folder', !fs.existsSync(t.trashDir));
check('purging leaves the recording intact',
      fs.existsSync(path.join(t.dir, 'steps', 'a.png')) && t.steps.length === 1);
t.purgeTrash();
check('purging an already-clean session does not throw', true);

// after purging, a restore must fail rather than half-succeed
check('restore after purge reports failure', t.restore(s2, 'steps/a.png') === false);

fs.rmSync(t.dir, { recursive: true, force: true });

fs.rmSync(dir, { recursive: true, force: true });
console.log('\nwhose words a step carries:');
{
  const w = new Session(path.join(os.tmpdir(), 'bsr-words-' + Date.now()));
  fs.mkdirSync(path.join(w.dir, 'steps'), { recursive: true });
  w.addStep(mk('p', 'Clicked the "Save" button'));

  // Rewriting a step by hand is authorship: export must leave those words
  // exactly as typed, in whatever tense they were typed.
  w.updateStep('p', { text: 'Press Save twice' });
  check('editing a step marks the words as the author\u2019s own',
        w.steps[0].textEdited === true);

  // But swapping one word inside the engine's own sentence is not. If that set
  // the flag, renaming a button would stop the export rewriting "Clicked" into
  // "Click" - putting those steps, and only those, into the past tense.
  const q = new Session(path.join(os.tmpdir(), 'bsr-words2-' + Date.now()));
  fs.mkdirSync(path.join(q.dir, 'steps'), { recursive: true });
  q.addStep(mk('r', 'Clicked the "Save" button'));
  q.updateStep('r', { text: 'Clicked the "Store" button', textEdited: false });

  check('a mechanical replacement does not claim authorship',
        q.steps[0].textEdited === false);
  check('and the new wording is kept',
        q.steps[0].text === 'Clicked the "Store" button');

  // An explicit claim is still honoured, so the ordinary edit path works when
  // it says what it means.
  q.updateStep('r', { text: 'Press Store', textEdited: true });
  check('an explicit claim is honoured', q.steps[0].textEdited === true);
}

console.log('\na recording that arrived from somebody else:');
{
  // The product's whole purpose is handing a recording folder to someone. So
  // session.json is not our data - it is a file from outside, and a path in it
  // is a claim. Left unchecked, a step naming ../../secrets could be read,
  // served to the window, written over when a region is blurred, and deleted
  // when the step is.
  const hostile = path.join(os.tmpdir(), 'bsr-hostile-' + Date.now());
  fs.mkdirSync(path.join(hostile, 'steps'), { recursive: true });

  // A file OUTSIDE the recording, standing in for anything on the machine.
  const outside = path.join(os.tmpdir(), 'bsr-outside-' + Date.now() + '.txt');
  fs.writeFileSync(outside, 'MUST SURVIVE');
  const escape = path.relative(hostile, outside).split(path.sep).join('/');

  fs.writeFileSync(path.join(hostile, 'session.json'), JSON.stringify({
    name: 'Sent to you',
    steps: [
      { id: 'ok', action: 'leftClick', text: 'Ordinary', screenshot: 'steps/a.png' },
      { id: 'up', action: 'leftClick', text: 'Climbs out', screenshot: escape },
      { id: 'abs', action: 'leftClick', text: 'Absolute', screenshot: outside },
    ],
  }));
  fs.writeFileSync(path.join(hostile, 'steps', 'a.png'), 'a picture');

  const opened = Session.load(hostile);

  check('it opens rather than refusing', opened.steps.length === 3);
  check('the ordinary step keeps its picture',
        opened.steps[0].screenshot === 'steps/a.png');
  check('a step climbing out loses its reference',
        opened.steps[1].screenshot === '');
  check('and an absolute one does too', opened.steps[2].screenshot === '');
  check('the step itself is kept, with its wording',
        opened.steps[1].text === 'Climbs out');
  check('and it is marked, not silently blanked',
        opened.steps[1].screenshotRejected === true);

  // The three file operations, each pointed at the rejected step.
  check('stashing it copies nothing', opened.stash(escape) === null);
  check('restoring it writes nothing', opened.restore('tok', escape) === false);
  opened.removeStep('up');
  check('deleting the step does not delete the file outside',
        fs.readFileSync(outside, 'utf8') === 'MUST SURVIVE');

  // And the one that would matter most: replaceStep deletes the superseded
  // picture. It must not follow a crafted reference either.
  const q = Session.load(hostile);
  q.replaceStep('abs', { id: 'abs', action: 'leftClick', text: 'new',
                         screenshot: 'steps/a.png' });
  check('and neither does re-recording it',
        fs.readFileSync(outside, 'utf8') === 'MUST SURVIVE');

  fs.rmSync(hostile, { recursive: true, force: true });
  fs.rmSync(outside, { force: true });
}


// ---------------------------------------------------------------------------
// Two steps, one screenshot.
//
// The engine writes a single file when consecutive captures are identical -
// a typed step and the click that flushes it see the same screen. From here
// on a screenshot is referred to by steps, not owned by one, and every path
// that deletes or rewrites one has to know that.
console.log('\nsharing one screenshot between two steps:');
{
  const dir2 = path.join(os.tmpdir(), 'bsr-share-test-' + Date.now());
  const t = new Session(dir2);
  fs.mkdirSync(path.join(dir2, 'steps'), { recursive: true });
  fs.writeFileSync(path.join(dir2, 'steps', 'shared.png'), 'PIXELS');
  fs.writeFileSync(path.join(dir2, 'steps', 'lone.png'), 'OTHER');

  const share = (id) => ({ id, seq: 0, action: 'leftClick', text: id,
                           point: { x: 1, y: 1 }, screenshot: 'steps/shared.png' });
  t.addStep(share('one'));
  t.addStep(share('two'));
  t.addStep({ ...share('three'), screenshot: 'steps/lone.png' });

  check('a shared screenshot is counted once per step',
        t.usesOf('steps/shared.png') === 2);
  check('and an unshared one once', t.usesOf('steps/lone.png') === 1);
  check('a name nothing refers to counts zero', t.usesOf('steps/gone.png') === 0);

  // ---- copy on write ------------------------------------------------------
  const before = t.steps[0].screenshot;
  const forked = t.forkScreenshot(t.steps[0]);
  check('editing a shared screenshot gives that step its own',
        forked !== null && forked !== before);
  check('the copy exists on disk',
        fs.existsSync(path.join(dir2, forked)));
  check('with the same pixels to start from',
        fs.readFileSync(path.join(dir2, forked), 'utf8') === 'PIXELS');
  check('the step now points at its own copy', t.steps[0].screenshot === forked);
  check('the other step still points at the original',
        t.steps[1].screenshot === 'steps/shared.png');
  check('and nothing is shared any more', t.usesOf('steps/shared.png') === 1);

  // The point of all of it: writing to one must not change the other.
  fs.writeFileSync(path.join(dir2, forked), 'BLURRED');
  check('so editing one leaves the other untouched',
        fs.readFileSync(path.join(dir2, 'steps', 'shared.png'), 'utf8') === 'PIXELS');

  check('a screenshot only one step uses is left where it is',
        t.forkScreenshot(t.steps[2]) === 'steps/lone.png');
  check('and is not copied', !fs.existsSync(path.join(dir2, 'steps', 'own-lone.png')));

  // ---- deleting -----------------------------------------------------------
  const dir3 = path.join(os.tmpdir(), 'bsr-share-del-' + Date.now());
  const u = new Session(dir3);
  fs.mkdirSync(path.join(dir3, 'steps'), { recursive: true });
  fs.writeFileSync(path.join(dir3, 'steps', 'both.png'), 'PIXELS');
  u.addStep({ id: 'p', seq: 0, action: 'leftClick', text: 'p',
              point: { x: 1, y: 1 }, screenshot: 'steps/both.png' });
  u.addStep({ id: 'q', seq: 0, action: 'leftClick', text: 'q',
              point: { x: 1, y: 1 }, screenshot: 'steps/both.png' });

  u.removeStep('p');
  check('deleting one of two sharers keeps the file',
        fs.existsSync(path.join(dir3, 'steps', 'both.png')));
  u.removeStep('q');
  check('and deleting the last one finally releases it',
        !fs.existsSync(path.join(dir3, 'steps', 'both.png')));

  // ---- re-recording -------------------------------------------------------
  const dir4 = path.join(os.tmpdir(), 'bsr-share-rerec-' + Date.now());
  const v = new Session(dir4);
  fs.mkdirSync(path.join(dir4, 'steps'), { recursive: true });
  fs.writeFileSync(path.join(dir4, 'steps', 'twin.png'), 'PIXELS');
  fs.writeFileSync(path.join(dir4, 'steps', 'fresh.png'), 'NEW');
  v.addStep({ id: 'r', seq: 0, action: 'leftClick', text: 'r',
              point: { x: 1, y: 1 }, screenshot: 'steps/twin.png' });
  v.addStep({ id: 's', seq: 0, action: 'leftClick', text: 's',
              point: { x: 1, y: 1 }, screenshot: 'steps/twin.png' });

  v.replaceStep('r', { id: 'X', seq: 0, action: 'leftClick', text: 'r again',
                       point: { x: 1, y: 1 }, screenshot: 'steps/fresh.png' });
  check('re-recording one sharer does not blank the other',
        fs.existsSync(path.join(dir4, 'steps', 'twin.png')));
  check('and the other still points at it',
        v.steps[1].screenshot === 'steps/twin.png');

  for (const d of [dir2, dir3, dir4]) fs.rmSync(d, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
