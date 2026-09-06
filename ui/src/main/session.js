const fs = require('node:fs');
const path = require('node:path');

/**
 * A recording session on disk:
 *   <dir>/session.json     step metadata, rewritten on every change
 *   <dir>/steps/NNNN.png   screenshots, written by the sidecar
 *
 * Metadata is flushed on every mutation. The original PSR lost everything on a
 * crash because it only serialised at export time; this is cheap insurance.
 */
class Session {
  constructor(dir) {
    this.dir = dir;
    this.steps = [];
    // Folders stay timestamped so two recordings can never collide; the name is
    // a label, and renaming must not move files around underneath a session.
    this.name = '';
    // What this recording is FOR, decided before it starts. It changes how the
    // steps are worded on the way out: a procedure tells the reader what to do,
    // an evidence record states what was done.
    this.purpose = 'sop';
    this.templatePath = '';
    fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
  }

  setIntent({ purpose, templatePath }) {
    if (purpose) this.purpose = purpose;
    if (templatePath !== undefined) this.templatePath = templatePath;
    this.flush();
    return { purpose: this.purpose, templatePath: this.templatePath };
  }

  rename(name) {
    this.name = String(name || '').slice(0, 120);
    this.flush();
    return this.name;
  }

  get metaPath() { return path.join(this.dir, 'session.json'); }
  get trashDir() { return path.join(this.dir, '.trash'); }

  /**
   * Moves a screenshot aside instead of deleting it, so an undo can put it
   * back. Blur and delete are otherwise irreversible, which during editing
   * means one slip costs a re-record.
   */
  stash(relative) {
    if (!relative) return null;
    const from = path.join(this.dir, relative);
    if (!fs.existsSync(from)) return null;

    fs.mkdirSync(this.trashDir, { recursive: true });
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-`
                  + path.basename(relative);
    const to = path.join(this.trashDir, token);
    fs.copyFileSync(from, to);
    return token;
  }

  /**
   * Deletes one stashed file. Called when its undo entry falls off the end of
   * the history: a pre-blur original is exactly the pixels the user redacted,
   * so it must not outlive the ability to restore it.
   */
  discard(token) {
    if (!token) return;
    try { fs.unlinkSync(path.join(this.trashDir, token)); } catch { /* already gone */ }
  }

  /**
   * Removes the trash entirely. Undo covers a slip while the session is open;
   * once it closes, keeping unredacted originals beside a redacted guide is
   * precisely the thing blur exists to prevent.
   */
  purgeTrash() {
    try { fs.rmSync(this.trashDir, { recursive: true, force: true }); } catch { /* fine */ }
  }

  /** Puts a stashed screenshot back at its original path. */
  restore(token, relative) {
    if (!token || !relative) return false;
    const from = path.join(this.trashDir, token);
    if (!fs.existsSync(from)) return false;

    const to = path.join(this.dir, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    try { fs.unlinkSync(from); } catch { /* leave it; harmless */ }
    return true;
  }

  /** Re-inserts a step at a known position, for undoing a delete. */
  insertAt(index, step) {
    const at = Math.max(0, Math.min(index, this.steps.length));
    this.steps.splice(at, 0, step);
    this.flush();
    return { index: at, step };
  }

  addStep(step) {
    // Double-click folding: the sidecar emits the first click immediately, then
    // supersedes it if a second one lands inside the double-click interval.
    if (step.supersedes) {
      const i = this.steps.findIndex((s) => s.id === step.supersedes);
      if (i !== -1) {
        step.screenshot = this.steps[i].screenshot || step.screenshot;
        this.steps[i] = step;
        this.flush();
        return { replaced: true, index: i, step };
      }
    }

    this.steps.push(step);
    this.flush();
    return { replaced: false, index: this.steps.length - 1, step };
  }

  /**
   * Swap in a fresh capture for an existing step, keeping its position in the
   * guide. The whole point of re-recording is that steps 1..n-1 stay valid.
   */
  replaceStep(id, fresh) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i === -1) return null;

    const old = this.steps[i];
    const merged = {
      ...fresh,
      id: old.id,                 // keep identity so selection and links survive
      seq: old.seq,
      // A description the user rewrote is worth more than a regenerated one:
      // the screenshot went stale, their prose usually did not.
      text: old.textEdited ? old.text : fresh.text,
      textEdited: old.textEdited || false,
      rerecordedAt: new Date().toISOString(),
    };

    this.steps[i] = merged;
    this.flush();

    // Drop the superseded screenshot once the new one is safely referenced.
    if (old.screenshot && old.screenshot !== merged.screenshot) {
      try { fs.unlinkSync(path.join(this.dir, old.screenshot)); } catch { /* already gone */ }
    }
    return { index: i, step: merged };
  }

  /**
   * Inserts a written step with no screenshot. Every procedure has instructions
   * that are not clicks - wait for the overnight batch, escalate above a
   * threshold, log into the VPN first - and without these a recording can only
   * ever describe what a mouse did.
   */
  addNote(text, afterId = null) {
    const note = {
      id: `note-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'note',
      ts: new Date().toISOString(),
      text: text || '',
      // A note is authored, never generated, so export must never rewrite it.
      textEdited: true,
    };

    const at = afterId ? this.steps.findIndex((s) => s.id === afterId) : -1;
    if (at === -1) this.steps.push(note);
    else this.steps.splice(at + 1, 0, note);

    this.flush();
    return { index: at === -1 ? this.steps.length - 1 : at + 1, step: note };
  }

  /**
   * Inserts a heading. A recording of forty clicks is three or four phases of
   * work, and a reader who cannot see the joins has to infer them.
   *
   * Deliberately the same shape as a note - authored text, no screenshot, no
   * number - because that is what it is. `level` is fixed at 1: sections do not
   * nest, and the field exists only so they could later without a migration.
   */
  addSection(text, afterId = null) {
    const section = {
      id: `sec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      action: 'section',
      ts: new Date().toISOString(),
      text: text || '',
      level: 1,
      // Authored, so export must never rewrite it into an instruction.
      textEdited: true,
    };

    const at = afterId ? this.steps.findIndex((s) => s.id === afterId) : -1;
    if (at === -1) this.steps.push(section);
    else this.steps.splice(at + 1, 0, section);

    this.flush();
    return { index: at === -1 ? this.steps.length - 1 : at + 1, step: section };
  }

  updateStep(id, patch) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i === -1) return null;
    // Remember that the wording is the user's, so a later re-record keeps it.
    if (patch.text !== undefined) patch = { ...patch, textEdited: true };
    this.steps[i] = { ...this.steps[i], ...patch };
    this.flush();
    return this.steps[i];
  }

  removeStep(id) {
    const index = this.steps.findIndex((s) => s.id === id);
    if (index === -1) return false;

    const doomed = this.steps[index];
    this.steps.splice(index, 1);
    this.flush();

    // Delete the screenshot too. A step is often deleted precisely because the
    // frame showed something it should not, and leaving the file behind means
    // zipping or syncing the session folder still carries it. It is stashed
    // first so an undo can restore it; purgeTrash() clears it when the session
    // closes or is replaced.
    let token = null;
    if (doomed.screenshot && !this.steps.some((s) => s.screenshot === doomed.screenshot)) {
      token = this.stash(doomed.screenshot);
      try { fs.unlinkSync(path.join(this.dir, doomed.screenshot)); } catch { /* gone */ }
    }
    return { index, step: doomed, token };
  }

  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.steps.length) return false;
    if (toIndex < 0 || toIndex >= this.steps.length) return false;
    const [moved] = this.steps.splice(fromIndex, 1);
    this.steps.splice(toIndex, 0, moved);
    this.flush();
    return true;
  }

  flush() {
    const payload = {
      v: 1, name: this.name, purpose: this.purpose, templatePath: this.templatePath,
      savedAt: new Date().toISOString(), steps: this.steps,
    };
    // Write-then-rename: a crash mid-write leaves the previous good file intact
    // rather than a truncated one.
    const tmp = this.metaPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), 'utf8');
    fs.renameSync(tmp, this.metaPath);
  }

  static load(dir) {
    const s = new Session(dir);
    const meta = path.join(dir, 'session.json');
    if (fs.existsSync(meta)) {
      try {
        const data = JSON.parse(fs.readFileSync(meta, 'utf8'));
        s.steps = data.steps || [];
        s.name = data.name || '';
        s.purpose = data.purpose || 'sop';
        s.templatePath = data.templatePath || '';
      } catch {
        s.steps = [];
      }
    }
    return s;
  }
}

module.exports = { Session };
