const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const DEFAULTS = {
  saveRoot: path.join(os.homedir(), 'Documents', 'StepRecordings'),
  imageFormat: 'png',   // png | jpeg
  imageQuality: 85,     // jpeg only
  imageScale: 1.0,      // 0.25 - 1.0
  imageFrame: 'window', // window | monitor | screen
  recordKeyboard: true,
  brandName: '',      // shown under the title, e.g. the team or company
  brandLogo: '',      // absolute path to an image embedded in exports
  brandFooter: '',    // e.g. a classification or document reference
};

class Settings {
  constructor(userDataDir) {
    this.file = path.join(userDataDir, 'settings.json');
    this.values = { ...DEFAULTS };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Merge over defaults so a settings file written by an older version
      // never leaves a new key undefined.
      this.values = { ...DEFAULTS, ...raw };
    } catch {
      this.values = { ...DEFAULTS };
    }
    this.#clamp();
    return this.values;
  }

  update(patch) {
    this.values = { ...this.values, ...patch };
    this.#clamp();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2), 'utf8');
    return this.values;
  }

  #clamp() {
    const v = this.values;
    v.imageFormat = v.imageFormat === 'jpeg' ? 'jpeg' : 'png';
    v.imageQuality = Math.min(100, Math.max(1, Number(v.imageQuality) || 85));
    v.imageScale = Math.min(1, Math.max(0.25, Number(v.imageScale) || 1));
    v.recordKeyboard = v.recordKeyboard !== false;
    if (!['window', 'monitor', 'screen'].includes(v.imageFrame)) v.imageFrame = 'window';
    for (const k of ['brandName', 'brandLogo', 'brandFooter']) {
      v[k] = typeof v[k] === 'string' ? v[k].slice(0, 400) : '';
    }
    if (typeof v.saveRoot !== 'string' || !v.saveRoot.trim()) v.saveRoot = DEFAULTS.saveRoot;
  }

  /** True if the configured save location is actually writable right now. */
  probe() {
    try {
      fs.mkdirSync(this.values.saveRoot, { recursive: true });
      const probe = path.join(this.values.saveRoot, '.write-test');
      fs.writeFileSync(probe, 'x');
      fs.unlinkSync(probe);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
}

module.exports = { Settings, DEFAULTS };
