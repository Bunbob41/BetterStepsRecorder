/**
 * Keyboard shortcuts, in the three forms they have to exist in.
 *
 * A global hotkey travels further than most settings:
 *
 *   Electron accelerator   "Control+Shift+F9"   what globalShortcut registers
 *   engine chord label     "Ctrl+Shift+F9"      what the capture engine must
 *                                               suppress, so that pressing stop
 *                                               is not recorded as the last step
 *   display keycaps        ["Ctrl","Shift","F9"] what the user reads
 *
 * Keeping the conversions in one place is the point: a rebind that reaches the
 * registration but not the engine gives you a recording whose final step is the
 * user pressing stop, which is exactly the bug the suppression exists to avoid.
 */

const DEFAULTS = {
  // Start, pause and resume - the one pressed over and over, mid-task, while
  // your hands are on the thing being recorded. Asked for as Ctrl+Shift+S
  // because it is reachable without looking; F9 is a stretch and a glance.
  //
  // The cost is real and worth stating: a global hotkey is TAKEN FROM every
  // other application while this one holds it, and Ctrl+Shift+S is Save As in
  // a good deal of software. While a recording is running, the application
  // being recorded will not see it. Rebindable in Settings, and stop is left
  // on a function key where nothing competes.
  pause: 'Control+Shift+S',
  stop: 'Control+Shift+F10',
};

/** Modifiers, in the order people say them. */
const MOD_ORDER = ['Control', 'Alt', 'Shift', 'Super'];

const DISPLAY = { Control: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Super: 'Win' };

/**
 * Keys the two sides spell differently.
 *
 * The engine names a key for a human reading a step - "Pressed Page Up" - and
 * an accelerator names it for `globalShortcut`. Where those disagree, the chord
 * the engine is told to suppress never matches the one it builds, and the
 * suppression silently does nothing: binding stop to Ctrl+Shift+PageUp put
 * "Pressed Ctrl+Shift+Page Up" at the end of every recording, which is the one
 * thing invariant 6 exists to prevent.
 *
 * Space has no name in the engine at all: it falls through to the printable
 * character, so the label really is a single space.
 */
const ENGINE_KEYS = { PageUp: 'PAGE UP', PageDown: 'PAGE DOWN', Space: ' ' };

/** Accelerator -> the label the capture engine builds for the same chord. */
function toEngineChord(accelerator) {
  const parts = String(accelerator || '').split('+').filter(Boolean);
  const mods = [];
  let key = '';

  for (const p of parts) {
    if (p === 'Control' || p === 'CommandOrControl') mods.push('Ctrl+');
    else if (p === 'Alt') mods.push('Alt+');
    else if (p === 'Super' || p === 'Meta') mods.push('Win+');
    else if (p === 'Shift') mods.push('Shift+');
    else key = p;
  }

  // The engine emits modifiers in a fixed order, so match it exactly.
  const order = ['Ctrl+', 'Alt+', 'Win+', 'Shift+'];
  const sorted = order.filter((m) => mods.includes(m));
  return sorted.join('') + (ENGINE_KEYS[key] || key).toUpperCase();
}

/** Accelerator -> the keys to draw as keycaps. */
function toDisplay(accelerator) {
  return String(accelerator || '').split('+').filter(Boolean)
    .map((p) => DISPLAY[p] || p);
}

/**
 * Builds an accelerator from a key press. Returns null for anything that would
 * make a bad global hotkey - a bare letter would swallow that key everywhere on
 * the machine, which is not a shortcut, it is a fault.
 */
function fromEvent({ key, code, ctrlKey, altKey, shiftKey, metaKey }) {
  if (['Control', 'Alt', 'Shift', 'Meta', 'OS'].includes(key)) return null;

  const mods = [];
  if (ctrlKey) mods.push('Control');
  if (altKey) mods.push('Alt');
  if (shiftKey) mods.push('Shift');
  if (metaKey) mods.push('Super');

  let main = '';
  if (/^F\d{1,2}$/.test(key)) main = key;                        // F1 - F24
  else if (key === ' ' || code === 'Space') main = 'Space';
  else if (key.length === 1) main = key.toUpperCase();
  else if (['Home', 'End', 'PageUp', 'PageDown', 'Insert', 'Delete',
            'Backspace', 'Tab', 'Enter'].includes(key)) main = key;
  else return null;

  // A function key alone is a legitimate global hotkey; anything else needs a
  // modifier or it hijacks ordinary typing across the whole machine.
  const isFunctionKey = /^F\d{1,2}$/.test(main);
  if (!mods.length && !isFunctionKey) return null;

  const ordered = MOD_ORDER.filter((m) => mods.includes(m));
  return [...ordered, main].join('+');
}

/** Rejects anything unusable before it reaches globalShortcut. */
function isValid(accelerator) {
  if (typeof accelerator !== 'string' || !accelerator.trim()) return false;
  const parts = accelerator.split('+').filter(Boolean);
  if (!parts.length) return false;

  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (mods.some((m) => !MOD_ORDER.includes(m) && m !== 'CommandOrControl')) return false;
  if (!mods.length && !/^F\d{1,2}$/.test(key)) return false;
  return true;
}

/** The two hotkeys as configured, falling back per-key to the defaults. */
function resolve(values = {}) {
  return {
    pause: isValid(values.hotkeyPause) ? values.hotkeyPause : DEFAULTS.pause,
    stop: isValid(values.hotkeyStop) ? values.hotkeyStop : DEFAULTS.stop,
  };
}

/** The chord labels the capture engine must ignore. */
function engineChords(values = {}) {
  const { pause, stop } = resolve(values);
  return [toEngineChord(pause), toEngineChord(stop)];
}

module.exports = {
  DEFAULTS, ENGINE_KEYS,
  toEngineChord, toDisplay, fromEvent, isValid, resolve, engineChords,
};
