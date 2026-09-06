const fs = require('node:fs');
const path = require('node:path');

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
function list(root, { readdir = fs.readdirSync, readFile = fs.readFileSync,
                      exists = fs.existsSync } = {}) {
  if (!root || !exists(root)) return [];

  const entries = [];
  for (const name of readdir(root)) {
    const dir = path.join(root, name);
    const meta = path.join(dir, 'session.json');
    if (!exists(meta)) continue;

    try {
      const data = JSON.parse(readFile(meta, 'utf8'));
      const steps = Array.isArray(data.steps) ? data.steps : [];
      entries.push({
        dir,
        // Falls back to the folder's name so a recording never lists as blank.
        name: data.name || name,
        steps: steps.filter((s) => s.action !== 'note').length,
        savedAt: data.savedAt || null,
        // From the first step that names one, so the card says what the
        // recording is actually about.
        app: (steps.find((s) => s.window && s.window.process) || {}).window?.process || '',
      });
    } catch {
      // A half-written session is skipped, not fatal.
    }
  }

  return entries.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
}

module.exports = { list };
