/**
 * Undo and redo.
 *
 * The property the whole design rests on: applying an entry returns the entry
 * that puts it back. If that holds, redo is undo pointed the other way and
 * there is no second implementation to drift.
 *
 * Tested against a fake session rather than a real one, because the awkward
 * cases - redoing a blur, undoing something whose screenshot has gone - are
 * awkward on paper and impossible to arrange on disk.
 */
const { History, applyEntry, tokensOf } = require('../ui/src/main/history');

let pass = 0, fail = 0;
const check = (n, ok) => { ok ? (pass++, console.log('  PASS ' + n)) : (fail++, console.log('  FAIL ' + n)); };

/** A session that records what was asked of it. Files are names, not bytes. */
function fakeSession(steps = []) {
  return {
    steps: steps.map((s) => ({ ...s })),
    files: {},              // relative path -> what is currently there
    trash: {},              // token -> what it holds
    discarded: [],

    insertAt(i, step) { this.steps.splice(i, 0, { ...step }); },

    removeStep(id) {
      const i = this.steps.findIndex((s) => s.id === id);
      if (i === -1) return null;
      const [step] = this.steps.splice(i, 1);
      const token = step.screenshot ? this.stash(step.screenshot) : null;
      return { index: i, step, token };
    },

    updateStep(id, patch) {
      const i = this.steps.findIndex((s) => s.id === id);
      if (i === -1) return null;
      this.steps[i] = { ...this.steps[i], ...patch };
      // `undefined` clears, exactly as a JSON round-trip would.
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined) delete this.steps[i][k];
      }
      return this.steps[i];
    },

    stash(rel) {
      if (!rel || this.files[rel] === undefined) return null;
      const token = 't' + Object.keys(this.trash).length + '-' + this.files[rel];
      this.trash[token] = this.files[rel];
      return token;
    },

    restore(token, rel) {
      if (!token || this.trash[token] === undefined) return false;
      this.files[rel] = this.trash[token];
      delete this.trash[token];
      return true;
    },

    swap(token, rel) {
      const displaced = this.stash(rel);
      if (!this.restore(token, rel)) return null;
      return displaced;
    },

    discard(token) { this.discarded.push(token); delete this.trash[token]; },
  };
}

const step = (id, text) => ({ id, action: 'leftClick', text, screenshot: `steps/${id}.png` });

console.log('the property everything rests on:');
{
  // Applying an entry returns the entry that puts it back. Every type.
  const s = fakeSession([step('a', 'one'), step('b', 'two')]);
  const entry = { type: 'retext', changes: [{ id: 'a', was: 'ORIGINAL', wasEdited: false }] };

  const first = applyEntry(s, entry);
  check('applying returns an inverse', first.ok && Boolean(first.inverse));
  check('and it took effect', s.steps[0].text === 'ORIGINAL');

  const back = applyEntry(s, first.inverse);
  check('applying the inverse returns another inverse', back.ok && Boolean(back.inverse));
  check('and puts it back exactly', s.steps[0].text === 'one');

  // Round-trips forever, not just once.
  applyEntry(s, back.inverse);
  check('and round-trips again', s.steps[0].text === 'ORIGINAL');
}

console.log('\nundo and redo a deletion:');
{
  const s = fakeSession([step('a', 'one'), step('b', 'two'), step('c', 'three')]);
  s.files['steps/b.png'] = 'B';

  const removed = s.removeStep('b');
  const h = new History({ discard: (t) => s.discard(t) });
  h.push({ type: 'restoreSteps', removals: [removed] });

  check('the step is gone', s.steps.map((x) => x.id).join() === 'a,c');
  check('and one undo is available', h.depth.undo === 1 && h.depth.redo === 0);

  h.undo(s);
  check('undo puts it back where it was', s.steps.map((x) => x.id).join() === 'a,b,c');
  check('with its screenshot', s.files['steps/b.png'] === 'B');
  check('and a redo is now available', h.depth.undo === 0 && h.depth.redo === 1);

  h.redo(s);
  check('redo takes it away again', s.steps.map((x) => x.id).join() === 'a,c');
  check('and undo is available once more', h.depth.undo === 1 && h.depth.redo === 0);

  h.undo(s);
  check('and it can go back and forth', s.steps.map((x) => x.id).join() === 'a,b,c');
}

console.log('\ntwenty steps deleted at once are one action:');
{
  const s = fakeSession([step('a'), step('b'), step('c'), step('d')]);
  const removals = [s.removeStep('b'), s.removeStep('c')];
  const h = new History({ discard: (t) => s.discard(t) });
  h.push({ type: 'restoreSteps', removals });

  h.undo(s);
  check('one undo brings them all back', s.steps.map((x) => x.id).join() === 'a,b,c,d');
  h.redo(s);
  check('and one redo takes them all away', s.steps.map((x) => x.id).join() === 'a,d');
}

console.log('\nredoing a blur, which is the one that used to be impossible:');
{
  // Undo restores the original over the blurred one. Without keeping the
  // blurred one there is nothing to redo WITH - which is why the old,
  // one-directional history could not have had redo bolted on.
  const s = fakeSession([{ id: 'a', action: 'leftClick', screenshot: 'steps/a.png' }]);
  s.files['steps/a.png'] = 'ORIGINAL';

  const token = s.stash('steps/a.png');
  s.files['steps/a.png'] = 'BLURRED';
  s.updateStep('a', { redacted: true });

  const h = new History({ discard: (t) => s.discard(t) });
  h.push({ type: 'pixels', id: 'a', screenshot: 'steps/a.png', token,
           state: { redacted: false, annotated: false, highlights: [],
                    cropped: false, frame: null } });

  h.undo(s);
  check('undo brings the original pixels back', s.files['steps/a.png'] === 'ORIGINAL');
  check('and unsets the redaction flag', s.steps[0].redacted === false);

  h.redo(s);
  check('redo brings the blurred pixels back', s.files['steps/a.png'] === 'BLURRED');
  check('and sets the flag again', s.steps[0].redacted === true);

  h.undo(s);
  check('and back once more', s.files['steps/a.png'] === 'ORIGINAL');
}

console.log('\na crop takes its frame with it, both ways:');
{
  const s = fakeSession([{ id: 'a', action: 'leftClick', screenshot: 'steps/a.png',
                           frame: { x: 0, y: 0, w: 800, h: 600 } }]);
  s.files['steps/a.png'] = 'FULL';

  const token = s.stash('steps/a.png');
  s.files['steps/a.png'] = 'CROPPED';
  s.updateStep('a', { cropped: true, frame: { x: 100, y: 50, w: 400, h: 300 } });

  const h = new History({ discard: (t) => s.discard(t) });
  h.push({ type: 'pixels', id: 'a', screenshot: 'steps/a.png', token,
           state: { redacted: false, annotated: false, highlights: [],
                    cropped: false, frame: { x: 0, y: 0, w: 800, h: 600 } } });

  h.undo(s);
  check('undo restores the picture', s.files['steps/a.png'] === 'FULL');
  // The one thing a crop must never leave behind: pixels and frame out of step.
  check('and the frame with it', s.steps[0].frame.w === 800);

  h.redo(s);
  check('redo crops the picture again', s.files['steps/a.png'] === 'CROPPED');
  check('and the frame with it', s.steps[0].frame.w === 400);
}

console.log('\nmoving the click marker:');
{
  const s = fakeSession([{ id: 'a', action: 'keyText' }]);
  const h = new History({ discard: (t) => s.discard(t) });

  s.updateStep('a', { markerAt: { x: 20, y: 30 } });
  h.push({ type: 'marker', id: 'a', at: null });

  h.undo(s);
  check('undo puts it back where it was recorded',
        s.steps[0].markerAt === undefined);
  h.redo(s);
  check('redo moves it again', s.steps[0].markerAt.x === 20);
}

console.log('\na new edit makes the future unreachable:');
{
  const s = fakeSession([step('a', 'one')]);
  const h = new History({ discard: (t) => s.discard(t) });

  h.push({ type: 'retext', changes: [{ id: 'a', was: 'zero', wasEdited: false }] });
  h.undo(s);
  check('there is something to redo', h.depth.redo === 1);

  h.push({ type: 'retext', changes: [{ id: 'a', was: 'other', wasEdited: false }] });
  check('and a new edit discards it', h.depth.redo === 0);
}

console.log('\nnothing is lost quietly:');
{
  const s = fakeSession([step('a', 'one')]);
  const h = new History({ discard: (t) => s.discard(t) });

  check('undo with nothing to undo says so', h.undo(s).empty === true);
  check('and so does redo', h.redo(s).empty === true);

  // An entry for a step that has gone must not be swallowed: putting it back
  // means it can be tried again once whatever is wrong is fixed.
  h.push({ type: 'retext', changes: [{ id: 'vanished', was: 'x', wasEdited: false }] });
  const r = h.undo(s);
  check('an entry that cannot be applied is reported', r.ok === false && !r.empty);
  check('and is kept rather than consumed', h.depth.undo === 1);

  // A blur whose stashed original has been cleared out.
  const t = new History({ discard: () => {} });
  t.push({ type: 'pixels', id: 'a', screenshot: 'steps/a.png', token: 'gone',
           state: { redacted: false, annotated: false, highlights: [], cropped: false } });
  const p = t.undo(s);
  check('a missing original is explained, not thrown', p.ok === false && /no longer/.test(p.error));
}

console.log('\nthe stashed screenshots are freed:');
{
  const s = fakeSession([step('a')]);
  const freed = [];
  const h = new History({ limit: 2, discard: (t) => freed.push(t) });

  h.push({ type: 'restoreSteps', removals: [{ index: 0, step: step('x'), token: 'tok-x' }] });
  h.push({ type: 'restoreSteps', removals: [{ index: 0, step: step('y'), token: 'tok-y' }] });
  check('nothing is freed while it can still be undone', freed.length === 0);

  h.push({ type: 'restoreSteps', removals: [{ index: 0, step: step('z'), token: 'tok-z' }] });
  check('the entry that fell off the end frees its file', freed.includes('tok-x'));

  check('and tokensOf sees a collective deletion',
        tokensOf({ type: 'restoreSteps',
                   removals: [{ token: 'p' }, { token: 'q' }] }).join() === 'p,q');
  check('as well as a single one', tokensOf({ type: 'pixels', token: 'r' }).join() === 'r');
  check('and nothing where there is nothing', tokensOf({ type: 'retext' }).length === 0);

  h.clear();
  check('closing frees the rest', freed.includes('tok-y') && freed.includes('tok-z'));
  check('and empties both stacks', h.depth.undo === 0 && h.depth.redo === 0);
}

console.log('\nhiding a marker is undone like moving one:');
{
  const steps = [{ id: 'a', markerAt: { x: 25, y: 25 } }];
  const session = {
    steps,
    updateStep(id, patch) {
      const i = steps.findIndex((s) => s.id === id);
      steps[i] = { ...steps[i], ...patch };
      for (const k of Object.keys(patch)) {
        if (patch[k] === undefined) delete steps[i][k];
      }
      return steps[i];
    },
  };

  const h = new History();
  // What the handler pushes before hiding: where it was, and that it showed.
  h.push({ type: 'marker', id: 'a', at: { x: 25, y: 25 }, hidden: false });
  session.updateStep('a', { markerHidden: true });

  h.undo(session);
  check('undo shows it again', steps[0].markerHidden === undefined);
  // The half that would be easy to lose: restoring "shown" while forgetting
  // where it was would put the step into a state it was never in.
  check('and keeps where it had been dragged to',
        steps[0].markerAt && steps[0].markerAt.x === 25);

  h.redo(session);
  check('redo hides it again', steps[0].markerHidden === true);
  check('still without losing the position',
        steps[0].markerAt && steps[0].markerAt.x === 25);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
