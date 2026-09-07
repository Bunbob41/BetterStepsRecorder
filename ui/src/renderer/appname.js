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
   * The best name available for one application.
   *
   * `product` is what the executable calls itself, and wins whenever it is
   * there - it is Windows' own answer rather than our guess.
   */
  function friendly(process, product) {
    const named = String(product || '').trim();
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

  return { KNOWN, tidy, friendly, dominant, forRecording };
}));
