const fs = require('node:fs');
const path = require('node:path');
const sections = require('../renderer/sections');
const appName = require('../renderer/appname');
const format = require('./format');

/**
 * The recordings on disk.
 *
 * A folder is a recording because it contains a readable session.json, not
 * because of what it is called. That distinction cost someone their recording:
 * folders are created as `session-<timestamp>` so two can never collide, and
 * the listing then required that prefix - so renaming a folder to something
 * meaningful, which is the obvious thing to do with a folder, made a 404MB
 * recording disappear from the application while sitting untouched on disk.
 *
 * The name inside session.json is the label the app shows and is editable in
 * the interface; the folder name belongs to the person whose disk it is.
 */
/**
 * How much room a recording takes, in bytes.
 *
 * Walked rather than remembered: the screenshots are written by the capture
 * engine, and a stored total would be wrong the moment anything touched them.
 * Measured at 12ms for nine recordings and 289 files, which is a price worth
 * paying to answer "which one of these is eating my disk".
 *
 * A folder that cannot be read contributes nothing rather than failing the
 * listing - the same bargain everything else here makes.
 */
function folderBytes(dir, { readdir, statOf }) {
  let total = 0;
  let entries;
  try {
    entries = readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }

  for (const entry of entries) {
    try {
      // Everything inside the guard, the name included: an entry this cannot
      // make sense of must cost its own size and nothing else. Outside it, a
      // single odd entry threw past the caller and dropped the whole recording
      // from the listing.
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += folderBytes(full, { readdir, statOf });
      else total += statOf(full).size;
    } catch {
      // A file that vanished between listing and measuring, or one we may not
      // read. It is not worth losing the whole figure over.
    }
  }
  return total;
}

function list(root, { readdir = fs.readdirSync, readFile = fs.readFileSync,
                      exists = fs.existsSync, statOf = fs.statSync } = {}) {
  if (!root || !exists(root)) return [];

  const entries = [];
  for (const name of readdir(root)) {
    const dir = path.join(root, name);
    const meta = path.join(dir, 'session.json');
    if (!exists(meta)) continue;

    let data;
    try {
      data = JSON.parse(readFile(meta, 'utf8'));
    } catch {
      // Listed, not skipped. This used to drop the recording from the screen
      // entirely, which is the failure D-24 is about: a recording that has
      // vanished from the list looks exactly like one that has been lost,
      // while its folder sits on disk with every screenshot in it.
      entries.push({
        dir, name, steps: 0, savedAt: null, app: '',
        bytes: folderBytes(dir, { readdir, statOf }),
        unreadable: format.damaged(),
        unreadableLabel: format.DAMAGED_LABEL,
      });
      continue;
    }

    try {
      const steps = Array.isArray(data.steps) ? data.steps : [];
      entries.push({
        dir,
        // Falls back to the folder's name so a recording never lists as blank.
        name: data.name || name,
        // Steps, not rows. This asked "is it not a note", which was the whole
        // question until headings existed - and then quietly counted every
        // heading as a step, so a card promised more work than the recording
        // held.
        steps: sections.countSteps(steps),
        savedAt: data.savedAt || null,
        // The application it spent its time in, named the way Windows names
        // it. This took the FIRST step that named a process - and a recording
        // almost always begins by clicking something on the taskbar, so every
        // card said "explorer.exe": the way in, not the thing documented.
        app: appName.forRecording(steps),
        // What it costs on disk. Screenshots stack up faster than anybody
        // expects, and somebody who cannot see that finds out when a disk
        // fills - which is the worst possible moment to learn it.
        bytes: folderBytes(dir, { readdir, statOf }),
        // Listed either way - a recording this version cannot open is still
        // one somebody has, and hiding it would look like it had been lost.
        unreadable: format.canRead(data) ? '' : format.refusal(data),
        unreadableLabel: format.canRead(data) ? '' : format.REFUSAL_LABEL,
      });
    } catch {
      // Anything else going wrong while describing a recording - an odd
      // directory entry, a stat that fails - costs that one entry, not the
      // listing.
    }
  }

  return entries.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

module.exports = { list, folderBytes };
