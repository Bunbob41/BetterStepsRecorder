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
    fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
  }

  get metaPath() { return path.join(this.dir, 'session.json'); }

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
    const doomed = this.steps.find((s) => s.id === id);
    if (!doomed) return false;

    this.steps = this.steps.filter((s) => s.id !== id);
    this.flush();

    // Delete the screenshot too. A step is often deleted precisely because the
    // frame showed something it should not, and leaving the file behind means
    // zipping or syncing the session folder still carries it.
    if (doomed.screenshot && !this.steps.some((s) => s.screenshot === doomed.screenshot)) {
      try { fs.unlinkSync(path.join(this.dir, doomed.screenshot)); } catch { /* already gone */ }
    }
    return true;
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
    const payload = { v: 1, savedAt: new Date().toISOString(), steps: this.steps };
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
        s.steps = JSON.parse(fs.readFileSync(meta, 'utf8')).steps || [];
      } catch {
        s.steps = [];
      }
    }
    return s;
  }
}

module.exports = { Session };
