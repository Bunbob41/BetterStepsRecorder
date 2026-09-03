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

  updateStep(id, patch) {
    const i = this.steps.findIndex((s) => s.id === id);
    if (i === -1) return null;
    this.steps[i] = { ...this.steps[i], ...patch };
    this.flush();
    return this.steps[i];
  }

  removeStep(id) {
    const before = this.steps.length;
    this.steps = this.steps.filter((s) => s.id !== id);
    if (this.steps.length !== before) this.flush();
    return this.steps.length !== before;
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
