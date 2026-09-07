/**
 * Searching every recording, not just the open one.
 *
 * A recording is written once and read months later. After forty of them the
 * question stops being "what does this guide say" and becomes "which of these
 * is the one where I set up the VPN" - and without an answer to that, an
 * archive is a pile rather than a record.
 *
 * The matching is `find.js`, unchanged: the same literal-not-a-pattern rule and
 * the same whole-word behaviour, so a search across the archive and a search
 * inside one recording never disagree about what matches.
 *
 * Reads from disk on every search rather than keeping an index. An index would
 * be faster and would be wrong the moment a recording is edited outside the
 * app; a few hundred small JSON files is milliseconds, and being right without
 * having to be invalidated is worth more than being fast.
 */
const fs = require('node:fs');
const path = require('node:path');
const find = require('../renderer/find');
const sections = require('../renderer/sections');
const appName = require('../renderer/appname');

/** How many matching steps to carry back per recording. */
const SNIPPETS = 4;

/**
 * Every recording whose name or steps contain `query`.
 *
 * Sorted by how much it matches, then by recency: someone searching an archive
 * wants the recording that is most about the thing, and falls back to the most
 * recent when several are equally about it.
 */
function search(root, query, { caseSensitive = false, wholeWord = false,
                               readdir = fs.readdirSync, readFile = fs.readFileSync,
                               exists = fs.existsSync } = {}) {
  const q = String(query == null ? '' : query).trim();
  if (!q || !root || !exists(root)) return [];

  const opts = { caseSensitive, wholeWord };
  const found = [];

  for (const entry of readdir(root)) {
    const dir = path.join(root, entry);
    const meta = path.join(dir, 'session.json');
    if (!exists(meta)) continue;

    let data;
    try {
      data = JSON.parse(readFile(meta, 'utf8'));
    } catch {
      // A half-written recording is skipped, not fatal - the same bargain the
      // listing makes.
      continue;
    }

    const steps = Array.isArray(data.steps) ? data.steps : [];
    // Falls back to the folder name, exactly as the listing does, so a search
    // can find a recording by the name a person actually sees.
    const name = data.name || entry;

    const hits = find.matches(steps, q, opts);
    const inName = find.countIn(name, q, opts);
    const total = inName + hits.reduce((n, h) => n + h.count, 0);
    if (!total) continue;

    found.push({
      dir,
      name,
      savedAt: data.savedAt || null,
      app: appName.forRecording(steps),
      steps: sections.countSteps(steps),
      total,
      inName: inName > 0,
      // Enough to recognise the recording by, not the whole thing: a search
      // result is a way in, and the recording itself is one click away.
      hits: hits.slice(0, SNIPPETS).map((h) => ({
        id: h.id, index: h.index, count: h.count,
        text: String(h.text == null ? '' : h.text),
      })),
      more: Math.max(0, hits.length - SNIPPETS),
    });
  }

  return found.sort((a, b) =>
    b.total - a.total || String(b.savedAt).localeCompare(String(a.savedAt)));
}

module.exports = { search, SNIPPETS };
