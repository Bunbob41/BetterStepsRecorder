/**
 * Undo and redo, as one idea rather than two.
 *
 * The stack used to be one-directional: an entry described a previous state
 * and applying it threw the current one away. That is why there was no redo -
 * not because nobody wrote it, but because the shape of the history made it
 * impossible.
 *
 * The shape here is symmetric. **Applying an entry returns the entry that
 * would put things back.** Undo pops from one stack and pushes the result onto
 * the other; redo does exactly the same in the other direction. There is one
 * implementation of each operation and no separate "redo" code to drift out of
 * step with the "undo" code.
 *
 * The entries come in pairs:
 *
 *   restoreSteps <-> removeSteps    a deletion, of one step or twenty
 *   retext       <-> retext         wording, symmetric with itself
 *   pixels       <-> pixels         a blur, an annotation or a crop
 *   marker       <-> marker         where the click indicator sits
 *   patchStep    <-> patchStep      fields on steps: wording, left out, a
 *                                   dismissed suggestion - symmetric
 *   reorder      <-> reorder        a step dragged to a new place
 *
 * And inserting a note or a section heading is recorded as the removeSteps that
 * takes it out again, so its opposite is the restoreSteps a deletion already
 * has.
 *
 * Pure of Electron so the awkward parts - a redo of a blur, an undo that finds
 * its screenshot gone - can be tested without a window.
 */

/** How many steps back a person can go. Beyond this the oldest is dropped. */
const LIMIT = 25;

/** Saves to one step's wording closer together than this are one piece of typing. */
const TYPING_MS = 2000;

/** The same change to several steps closer together than this is one action. */
const BATCH_MS = 500;

/** Every stash token an entry is holding, so an evicted one frees its files. */
function tokensOf(entry) {
  if (!entry) return [];
  if (entry.type === 'restoreSteps') {
    return (entry.removals || []).map((r) => r.token).filter(Boolean);
  }
  return entry.token ? [entry.token] : [];
}

/**
 * Applies one entry to a session and returns its opposite.
 *
 * Returns `{ ok: false, error }` rather than throwing: a screenshot that has
 * gone missing is a thing to explain, not a crash.
 */
function applyEntry(session, entry) {
  if (!session || !entry) return { ok: false, error: 'Nothing to undo.' };

  switch (entry.type) {
    // ---- a deletion, going back -------------------------------------------
    case 'restoreSteps': {
      const ids = [];
      // In order, so each index means what it meant when that step was cut.
      for (const r of [...(entry.removals || [])].reverse()) {
        if (r.token) session.restore(r.token, r.step.screenshot);
        session.insertAt(r.index, r.step);
        ids.push(r.step.id);
      }
      return { ok: true, inverse: { type: 'removeSteps', ids: ids.reverse() } };
    }

    // ---- and going forward again ------------------------------------------
    case 'removeSteps': {
      const removals = [];
      for (const id of entry.ids || []) {
        const gone = session.removeStep(id);
        if (gone) removals.push(gone);
      }
      if (!removals.length) return { ok: false, error: 'Those steps are no longer here.' };
      return { ok: true, inverse: { type: 'restoreSteps', removals } };
    }

    // ---- wording ----------------------------------------------------------
    case 'retext': {
      const before = [];
      for (const c of entry.changes || []) {
        const step = session.steps.find((s) => s.id === c.id);
        if (!step) continue;
        // Captured before the write, so the opposite entry describes the state
        // this one is about to replace.
        before.push({ id: c.id, was: step.text, wasEdited: Boolean(step.textEdited) });
        session.updateStep(c.id, { text: c.was, textEdited: c.wasEdited });
      }
      if (!before.length) return { ok: false, error: 'Those steps are no longer here.' };
      return { ok: true, inverse: { type: 'retext', changes: before } };
    }

    // ---- fields on steps: wording, left out, a dismissed suggestion --------
    case 'patchStep': {
      const before = [];
      for (const c of entry.changes || []) {
        const step = session.steps.find((s) => s.id === c.id);
        if (!step) continue;
        // The same fields, as they stand now, become the opposite entry.
        // textEdited as a boolean: left undefined, updateStep would read a
        // wording change as authored and mark it so on the way back.
        const now = {};
        for (const k of Object.keys(c.was || {})) {
          now[k] = k === 'textEdited' ? Boolean(step[k]) : step[k];
        }
        before.push({ id: c.id, was: now });
        session.updateStep(c.id, { ...c.was });
      }
      if (!before.length) return { ok: false, error: 'Those steps are no longer here.' };
      return { ok: true, inverse: { type: 'patchStep', changes: before } };
    }

    // ---- a step dragged to a new place -------------------------------------
    case 'reorder': {
      // Recorded as the move that puts it back, so its opposite is the same
      // move the other way.
      if (typeof session.reorder !== 'function' || !session.reorder(entry.from, entry.to)) {
        return { ok: false, error: 'That step has moved since.' };
      }
      return { ok: true, inverse: { type: 'reorder', from: entry.to, to: entry.from } };
    }

    // ---- pixels: a blur, an annotation, or a crop --------------------------
    case 'pixels': {
      const step = session.steps.find((s) => s.id === entry.id);
      if (!step) return { ok: false, error: 'That step is no longer here.' };

      // Swap rather than restore: putting the original back must keep the
      // edited one, or there is nothing to redo with.
      const displaced = session.swap(entry.token, entry.screenshot);
      if (!displaced && entry.token) {
        return { ok: false, error: 'The original screenshot is no longer available.' };
      }

      const now = {
        redacted: step.redacted === true,
        annotated: step.annotated === true,
        highlights: [...(step.highlights || [])],
        cropped: step.cropped === true,
        frame: step.frame ? { ...step.frame } : null,
        markerAt: step.markerAt ? { ...step.markerAt } : null,
        marks: Array.isArray(step.marks) ? step.marks.map((m) => ({ ...m })) : null,
        size: step.size ? { ...step.size } : null,
      };

      session.updateStep(entry.id, {
        redacted: entry.state.redacted,
        annotated: entry.state.annotated,
        highlights: entry.state.highlights,
        cropped: entry.state.cropped,
        ...(entry.state.frame ? { frame: entry.state.frame } : {}),
        // Put back where the marker and the marks were on THIS picture. An
        // entry written before these were carried has neither, and undefined
        // leaves them alone rather than wiping them.
        ...(entry.state.markerAt !== undefined
              ? { markerAt: entry.state.markerAt || undefined } : {}),
        ...(entry.state.marks !== undefined
              ? { marks: entry.state.marks || undefined } : {}),
        ...(entry.state.size !== undefined
              ? { size: entry.state.size || undefined } : {}),
        editedAt: new Date().toISOString(),
      });

      return { ok: true,
               inverse: { type: 'pixels', id: entry.id, screenshot: entry.screenshot,
                          token: displaced, state: now } };
    }

    // ---- the marks drawn on a screenshot -----------------------------------
    case 'marks': {
      const step = session.steps.find((s) => s.id === entry.id);
      if (!step) return { ok: false, error: 'That step is no longer here.' };

      // The list as it stands becomes the inverse, so undo and redo are the
      // same traversal run in opposite directions - the rule invariant 20 is
      // about, and the reason this can be one entry rather than one per mark.
      const now = [...(step.marks || [])];
      session.setMarks(entry.id, entry.marks || []);
      return { ok: true,
               inverse: { type: 'marks', id: entry.id, marks: now } };
    }

    // ---- where the click indicator sits ------------------------------------
    case 'marker': {
      const step = session.steps.find((s) => s.id === entry.id);
      if (!step) return { ok: false, error: 'That step is no longer here.' };

      // Both halves of what the marker is: where it sits and whether it is
      // shown. Restoring one and not the other would put the step back into a
      // state it was never in.
      const now = {
        at: step.markerAt ? { ...step.markerAt } : null,
        hidden: step.markerHidden === true,
        angle: Number.isFinite(step.markerAngle) ? step.markerAngle : null,
      };
      session.updateStep(entry.id, {
        markerAt: entry.at || undefined,
        markerHidden: entry.hidden ? true : undefined,
        markerAngle: Number.isFinite(entry.angle) ? entry.angle : undefined,
      });
      return { ok: true,
               inverse: { type: 'marker', id: entry.id, at: now.at,
                          hidden: now.hidden, angle: now.angle } };
    }

    default:
      return { ok: false, error: 'That change cannot be undone.' };
  }
}

/**
 * The two stacks.
 *
 * `discard` frees the screenshot an evicted entry was holding - without it the
 * trash grows for the life of the session with copies nobody can reach.
 */
class History {
  constructor({ limit = LIMIT, discard = () => {} } = {}) {
    this.limit = limit;
    this.discard = discard;
    this.past = [];
    this.future = [];
  }

  get depth() { return { undo: this.past.length, redo: this.future.length }; }

  /** Records an edit. Anything that could have been redone no longer can. */
  // The last field change recorded, kept so the next one can join it when it is
  // the same act continuing.
  #lastPatch = null;

  /**
   * Records a change to fields on a step, joining the previous change when it
   * is the same act rather than a new one.
   *
   * Two cases join, and both are about what a person would call one thing:
   *
   *  - Typing. The window saves wording after a short pause, so a sentence
   *    arrives as several saves. Undo taking it back one pause at a time is not
   *    undo. Saves to the same step's wording within TYPING_MS join, and the
   *    entry keeps the wording from before the first of them.
   *  - The same change to several steps at once - excluding a selection sends
   *    one save per step, a moment apart. Within BATCH_MS and with the same
   *    fields, they become one entry covering all of them.
   *
   * Only while that entry is still the latest thing in the history: once
   * anything else has happened, or it has been undone, the next change starts
   * afresh.
   */
  pushPatch(id, was, now = Date.now()) {
    const keys = Object.keys(was).sort().join(',');
    const last = this.past[this.past.length - 1];
    const prior = this.#lastPatch;
    const continuing = prior && prior.entry === last && prior.keys === keys;

    if (continuing) {
      const typing = keys === 'text,textEdited';
      const already = last.changes.some((c) => c.id === id);
      if (typing && already && now - prior.at < TYPING_MS) {
        prior.at = now;
        return false;
      }
      if (!typing && !already && now - prior.at < BATCH_MS) {
        last.changes.push({ id, was });
        prior.at = now;
        return false;
      }
    }

    const entry = { type: 'patchStep', changes: [{ id, was }] };
    this.push(entry);
    this.#lastPatch = { entry, keys, at: now };
    return true;
  }

  push(entry) {
    this.past.push(entry);
    // A new edit makes the future unreachable, and its stashed files with it.
    for (const e of this.future) for (const t of tokensOf(e)) this.discard(t);
    this.future = [];

    while (this.past.length > this.limit) {
      const dropped = this.past.shift();
      for (const t of tokensOf(dropped)) this.discard(t);
    }
  }

  undo(session) { return this.#move(session, this.past, this.future); }
  redo(session) { return this.#move(session, this.future, this.past); }

  #move(session, from, to) {
    if (!from.length) return { ok: false, empty: true };
    const entry = from.pop();
    const r = applyEntry(session, entry);
    if (!r.ok) {
      // A failed application must not silently swallow the entry: putting it
      // back means the person can try again once whatever is wrong is fixed.
      from.push(entry);
      return r;
    }
    to.push(r.inverse);
    return { ok: true, type: entry.type };
  }

  clear() {
    for (const e of [...this.past, ...this.future]) {
      for (const t of tokensOf(e)) this.discard(t);
    }
    this.past = [];
    this.future = [];
  }
}

module.exports = { History, applyEntry, tokensOf, LIMIT };
