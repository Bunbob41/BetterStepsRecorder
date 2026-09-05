const fs = require('node:fs');
const path = require('node:path');

/**
 * The templates a recording can be rendered into.
 *
 * Two sources, kept apart on purpose:
 *
 *   built in - ships with the app, read-only, always present. "System default"
 *              is one of these: a complete corporate SOP structure with
 *              metadata, numbered steps, a revision table and a signature
 *              block, for someone who has no format of their own yet.
 *   yours    - anything dropped into the user's templates folder, which is
 *              where an organisation's own document goes.
 *
 * Choosing happens BEFORE recording rather than at export, because the choice
 * changes what the recording is for, and a person setting out to write a
 * procedure knows that at the start.
 */

const KINDS = { '.md': 'Markdown', '.html': 'HTML', '.txt': 'Text', '.docx': 'Word' };

/** Where a user's own templates live. Created on first look. */
function userDir(userDataPath) {
  const dir = path.join(userDataPath, 'templates');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* listing still works */ }
  return dir;
}

/** Built-in templates, in the source tree during development and beside the app once packaged. */
function builtInDir(projectRoot) {
  const candidates = [
    path.join(process.resourcesPath || '', 'templates'),
    path.join(projectRoot, 'templates'),
  ];
  return candidates.find((d) => d && fs.existsSync(d)) || null;
}

function describe(file, origin) {
  const ext = path.extname(file).toLowerCase();
  const base = path.basename(file, ext);
  const isDefault = origin === 'builtin' && base.startsWith('corporate-sop');

  return {
    path: file,
    kind: KINDS[ext] || ext.replace('.', '').toUpperCase(),
    origin,
    // The built-in SOP structure is the starting point for anyone without a
    // format of their own, so it is named as such rather than by its filename.
    name: isDefault ? `System default (${KINDS[ext]})` : base.replace(/[-_]/g, ' '),
    isDefault,
  };
}

function listIn(dir, origin) {
  if (!dir || !fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => KINDS[path.extname(f).toLowerCase()])
      .map((f) => describe(path.join(dir, f), origin));
  } catch {
    return [];
  }
}

/**
 * Every template available, system defaults first so the list opens on a
 * working choice rather than an empty one.
 */
function list(projectRoot, userDataPath) {
  const builtin = listIn(builtInDir(projectRoot), 'builtin');
  const mine = listIn(userDir(userDataPath), 'user');

  // Defaults first, and Word ahead of Markdown within them: a .docx is what an
  // organisation usually expects to be handed.
  const rank = (t) => (t.isDefault ? 0 : 1) * 10 + (t.kind === 'Word' ? 0 : 1);
  builtin.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  mine.sort((a, b) => a.name.localeCompare(b.name));

  return { templates: [...builtin, ...mine], userDir: userDir(userDataPath) };
}

/** The template a new recording should start on when nothing is chosen. */
function defaultFor(projectRoot, userDataPath, preferred = '') {
  if (preferred && fs.existsSync(preferred)) return preferred;
  const { templates } = list(projectRoot, userDataPath);
  const def = templates.find((t) => t.isDefault && t.kind === 'Word')
           || templates.find((t) => t.isDefault)
           || templates[0];
  return def ? def.path : '';
}

module.exports = { list, defaultFor, userDir };
