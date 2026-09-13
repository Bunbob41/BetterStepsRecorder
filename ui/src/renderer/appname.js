/**
 * What to call the application a recording is about.
 *
 * `explorer.exe` is the truth and it is nobody's idea of an answer. A person
 * looking at a list of recordings is trying to remember which one is which, and
 * "Google Chrome" does that where a filename does not.
 *
 * Windows already knows the good name: every executable carries a
 * FileDescription, which is where "Google Chrome" and "Windows Explorer" come
 * from. The engine reads it and records it as `window.product`, so for anything
 * recorded from now on this module has the right answer handed to it.
 *
 * Recordings made before that exist too, and they only have the filename. So
 * there is a fallback: a short list of Windows' own executables whose names are
 * genuinely opaque, and otherwise the filename tidied up. "chrome.exe" becomes
 * "Chrome", which is not "Google Chrome" but is a great deal better than
 * "chrome.exe".
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BsrAppName = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  /**
   * Only where the filename tells a person nothing, and only Windows' own.
   *
   * Deliberately short. A long list of every application anybody might record
   * would be a thing to maintain forever and would still be missing whatever
   * the next person uses - the FileDescription the engine now records is the
   * general answer, and this covers the recordings made before it existed.
   */
  const KNOWN = {
    'explorer.exe': 'File Explorer',
    'systemsettings.exe': 'Settings',
    'applicationframehost.exe': 'a Windows app',
    'taskmgr.exe': 'Task Manager',
    'control.exe': 'Control Panel',
    'mmc.exe': 'Management Console',
    'cmd.exe': 'Command Prompt',
    'powershell.exe': 'PowerShell',
    'pwsh.exe': 'PowerShell',
    'windowsterminal.exe': 'Windows Terminal',
    'mstsc.exe': 'Remote Desktop',
    'rundll32.exe': 'a Windows dialog',
    'dllhost.exe': 'a Windows dialog',
  };

  /** "chrome.exe" -> "Chrome". Left alone if it already has its own casing. */
  function tidy(process) {
    const base = String(process || '').replace(/\.exe$/i, '').trim();
    if (!base) return '';
    // Something like "WindowsTerminal" or "iTunes" was capitalised by whoever
    // shipped it; re-casing that makes it worse, not better.
    const oneCase = base === base.toLowerCase() || base === base.toUpperCase();
    if (!oneCase) return base;
    return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase();
  }

  /**
   * A product name with the damage its own program shipped with taken out.
   *
   * Not hypothetical. Read straight off C:\\HYPACK 2025\\x64\\SBMAX64.exe, its
   * FileDescription is "HYPACK" followed by U+00EF U+00BF U+00BD - the bytes of
   * a replacement character, re-read in the wrong code page by whatever built
   * it - where a trademark sign should be. The engine copies it faithfully, and
   * it then appeared on every row, every library card and every exported guide.
   *
   * Cleaned here, where names are shown, rather than in the recording: the
   * recording keeps exactly what Windows reported. Removed rather than guessed
   * at, because it could as easily have been a TM as an R, and a wrong symbol
   * would be a new mistake rather than the removal of an old one. A real
   * trademark sign is left alone.
   */
  function clean(name) {
    return String(name || '')
      .replace(/\u00ef\u00bf\u00bd|\ufffd/g, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * The best name available for one application.
   *
   * `product` is what the executable calls itself, and wins whenever it is
   * there - it is Windows' own answer rather than our guess.
   */
  function friendly(process, product) {
    const named = clean(product);
    if (named) return named;

    const key = String(process || '').trim().toLowerCase();
    if (!key) return '';
    return KNOWN[key] || tidy(process);
  }

  /**
   * The application a recording is mostly about.
   *
   * By tally, not by first step. A recording almost always begins by clicking
   * something on the taskbar, so "the first step that names a process" labelled
   * every one of them File Explorer - naming the way in rather than the thing
   * being documented.
   */
  function dominant(steps) {
    const tally = new Map();
    for (const step of steps || []) {
      const w = step && step.window;
      const process = w && w.process;
      if (!process) continue;
      const entry = tally.get(process) || { process, product: '', count: 0 };
      entry.count++;
      // Keep whichever product name came with it; they agree in practice, and
      // an older step without one should not erase a newer step's.
      if (!entry.product && w.product) entry.product = w.product;
      tally.set(process, entry);
    }

    let best = null;
    for (const entry of tally.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    return best;
  }

  /** The label for a whole recording: its dominant application, named well. */
  function forRecording(steps) {
    const best = dominant(steps);
    return best ? friendly(best.process, best.product) : '';
  }

  /**
   * What to call a recording nobody named.
   *
   * The name is not decoration: it becomes the heading of an exported guide and
   * the caption under every figure in it. Left as the time the recording
   * started, a thirty-seven step procedure carries "9/11/2026, 3:42:26 PM"
   * thirty-seven times, which says nothing about anything.
   *
   * The application, and only the application. It used to carry the step count
   * as well - "HYPACK Shell - 37 steps" - and that was a mistake in two places:
   * the library card printed the count again beside it, and an exported guide
   * took the name as its title, where nobody heads a procedure with its length.
   * `count` still decides whether there is anything to name at all.
   *
   * Empty when there is nothing to say: a recording with no window in it has no
   * application to be named after, and "0 steps" is not a name. The caller keeps
   * whatever it had.
   */
  function label(steps, count) {
    const app = forRecording(steps);
    if (!app || !count) return '';
    return app;
  }

  /**
   * What an action is called on screen.
   *
   * The step list printed the engine's own identifiers - leftClick, keyPress -
   * under every row. Those are the recorder's words for its protocol, not a
   * person's words for what they did.
   */
  const ACTIONS = {
    leftClick: 'Click',
    rightClick: 'Right-click',
    doubleClick: 'Double-click',
    drag: 'Drag',
    keyPress: 'Keyboard',
    photo: 'Photo',
  };

  function actionWord(action) {
    const a = String(action || '');
    if (ACTIONS[a]) return ACTIONS[a];
    // The engine is newer than any list here. An action nobody has named yet
    // still reads as words rather than as an identifier.
    const spaced = a.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : '';
  }

  /**
   * A step's wording for the list, without the window the row above named.
   *
   * Generated wording ends ' in "Window title"', so a recording made in one
   * dialog repeated that dialog's name on every row - and the list truncates
   * from the right, so it cut each title off exactly where it started saying
   * something. Dropped only when the previous recorded step was in the same
   * window, so the first row, and every row where the window changes, keeps it.
   *
   * Only ever for the list. The recording and every export keep the full text.
   * Never touched when a person wrote the wording.
   */
  function rowTitle(step, prev) {
    const text = String((step && step.text) || '');
    if (!text || step.textEdited) return text;
    const here = step.window && step.window.title;
    const before = prev && prev.window && prev.window.title;
    if (!here || here !== before) return text;
    const tail = ` in "${here}"`;
    if (!text.endsWith(tail)) return text;
    // Dropped whatever is left in front of it - a bare verb included. Two
    // earlier guards kept the window when the rest looked too thin to stand
    // alone, first "no quoted target", then "a single word", and a live run
    // against a real recording disproved each: three "Pressed Tab in "Project
    // Wizard"" rows, then five "Dragged in "SBMAX64 - RAW1201.LOG - Depth"". A
    // window the row above already named tells the reader nothing, whatever
    // sits in front of it. The first row in each window still names it, because
    // there the window differs from the row before.
    return text.slice(0, -tail.length);
  }

  return { KNOWN, tidy, clean, friendly, dominant, forRecording, label,
           actionWord, rowTitle };
}));
