const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * `documentsDir` is passed in rather than derived from the home directory.
 * Windows redirects Documents when OneDrive's Known Folder Move is on - a very
 * common setup - and `%USERPROFILE%\Documents` may then not exist at all, so
 * recordings would be written somewhere the user never looks, or fail the
 * writability check outright. Electron's app.getPath('documents') resolves the
 * real folder.
 */
function defaults(documentsDir) {
  return {
    ...DEFAULTS,
    saveRoot: path.join(documentsDir || path.join(os.homedir(), 'Documents'),
                        'StepRecordings'),
  };
}

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
  templatePath: '',   // an organisation's own SOP format to render into
  // How the click is marked on each screenshot. A ring reads as an error to
  // some readers, or as part of the application being documented; an arrow
  // is unambiguously an annotation on the picture.
  markerStyle: 'circle',
  markerBold: false,
  hotkeyPause: '',    // blank means the built-in default
  hotkeyStop: '',
};

class Settings {
  constructor(userDataDir, { documentsDir = '' } = {}) {
    this.file = path.join(userDataDir, 'settings.json');
    this.defaults = defaults(documentsDir);
    this.values = { ...this.defaults };
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      // Merge over defaults so a settings file written by an older version
      // never leaves a new key undefined.
      this.values = { ...this.defaults, ...raw };
    } catch {
      this.values = { ...this.defaults };
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
    for (const k of ['brandName', 'brandLogo', 'brandFooter', 'templatePath',
                     'hotkeyPause', 'hotkeyStop']) {
      v[k] = typeof v[k] === 'string' ? v[k].slice(0, 400) : '';
    }
    if (typeof v.saveRoot !== 'string' || !v.saveRoot.trim()) v.saveRoot = this.defaults.saveRoot;
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

module.exports = { Settings, DEFAULTS, defaults };
