const fs = require('node:fs');
const { toImperative, windowTracker, legendLines } = require('./export');
const path = require('node:path');
const os = require('node:os');

/**
 * Renders a recording into someone else's document format.
 *
 * The template is treated as an immutable spine: it is read, never written, and
 * anything the engine does not recognise is left exactly as it was. That matters
 * because the value of this feature is that the output IS the organisation's own
 * SOP format - headings, numbering, revision tables, approval blocks and all -
 * not our format wearing their logo.
 *
 * Two kinds of hook:
 *
 *   <!-- PARSER_HOOK: INJECT_TITLE -->        a single value, replaced in place
 *   <!-- PARSER_HOOK: START_STEPS -->         a repeatable block; everything up
 *   ...row template using {{placeholders}}    to END_STEPS is the row, emitted
 *   <!-- PARSER_HOOK: END_STEPS -->           once per step
 *
 * HTML comments are used rather than a bare {{mustache}} at the top level so the
 * template stays a valid, readable document in Word, Confluence or a git wiki
 * before anything is injected. Placeholders inside a loop body are plain
 * {{name}}, because that block is never seen by a human reader.
 */

const HOOK = /<!--\s*PARSER_HOOK:\s*([A-Z0-9_]+)\s*-->/g;

/** Loop hooks, as START/END pairs. Aliases keep older templates working. */
const LOOPS = [
  { start: 'START_DYNAMIC_STEPS_LOOP', end: 'END_DYNAMIC_STEPS_LOOP', kind: 'steps' },
  { start: 'START_STEPS', end: 'END_STEPS', kind: 'steps' },
  { start: 'START_IMAGE_GALLERY', end: 'END_IMAGE_GALLERY', kind: 'gallery' },
];

/** Used when a loop block carries no {{placeholders}} of its own. */
const DEFAULT_ROW = {
  steps: '{{number}}. {{description}}\n\n{{image_block}}\n',
  gallery: '**Step {{number}}** - {{description}}\n\n{{image_block}}\n',
};

const oneLine = (v) => String(v ?? '').replace(/\s*\n\s*/g, ' ').trim();

/**
 * What actually happened to this recording, rather than a blanket assurance.
 * A compliance section that claims more than the tool did is worse than one
 * that claims nothing.
 */
function redactionSummary(allSteps) {
  // Deliberately the FULL list: the reader needs to know that steps were held
  // back from this document, which is invisible if you count what remains.
  const steps = allSteps.filter((s) => !s.excluded);
  const passwords = steps.filter((s) => s.action === 'password').length;
  const blurred = steps.filter((s) => s.redacted).length;
  const masked = steps.filter((s) => (s.typed || '').includes('[redacted]')).length;
  const excluded = allSteps.filter((s) => s.excluded).length;

  const parts = [];
  parts.push(passwords
    ? `${passwords} password entr${passwords === 1 ? 'y' : 'ies'} recorded without their contents`
    : 'no password fields were typed into during this recording');
  if (masked) parts.push(`${masked} typed value(s) masked as card or national-insurance shaped`);
  parts.push(blurred
    ? `${blurred} screenshot(s) had regions blurred by the author`
    : 'no screenshot regions were blurred by the author');
  if (excluded) parts.push(`${excluded} step(s) were excluded from this document`);

  return parts.join('; ') + '.';
}

/** The application a recording is mostly about. */
function dominantApp(steps) {
  const tally = new Map();
  for (const s of steps) {
    const p = s.window && s.window.process;
    if (p) tally.set(p, (tally.get(p) || 0) + 1);
  }
  let best = '', n = 0;
  for (const [p, c] of tally) if (c > n) { best = p; n = c; }
  return best;
}

function docId(session, when) {
  const stamp = when.toISOString().slice(0, 10).replace(/-/g, '');
  // Stable for a given recording: the same session always yields the same id.
  let h = 0;
  for (const ch of session.dir) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `SOP-${stamp}-${h.toString(16).slice(0, 4).toUpperCase()}`;
}

function buildValues(session, steps, allSteps, opts) {
  const when = new Date();
  return {
    INJECT_TITLE: opts.title || session.name || 'Recorded procedure',
    INJECT_DOC_ID: opts.docId || docId(session, when),
    INJECT_TIMESTAMP: when.toISOString(),
    INJECT_DATE: when.toISOString().slice(0, 10),
    INJECT_TARGET_APP: dominantApp(steps) || 'Not recorded',
    INJECT_USER_ID: opts.userId || os.userInfo().username,
    INJECT_OS_ENVIRONMENT: `${os.type()} ${os.release()}`,
    INJECT_STEP_COUNT: String(steps.filter((s) => s.action !== 'note').length),
    INJECT_ORGANISATION: opts.brand && opts.brand.name ? opts.brand.name : '',
    INJECT_REDACTION_SUMMARY: redactionSummary(allSteps),
    // Empty when no legend was asked for, so a template carrying the hook does
    // not print an empty heading for guides that use one colour.
    INJECT_HIGHLIGHT_LEGEND: legendLines(opts.legend).join('; '),
  };
}

function fillRow(row, vars) {
  return row.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (whole, name) => {
    const key = name.toLowerCase();
    return key in vars ? String(vars[key]) : whole;
  });
}

function stepVars(step, number, imageDir, voice = 'imperative', describe = null) {
  const file = step.screenshot ? path.basename(step.screenshot) : '';
  const rel = file ? `${imageDir}/${file}` : '';
  const isNote = step.action === 'note';
  return {
    number: isNote ? '' : String(number),
    // "3. " for a step and "" for a note, so a row template can carry the
    // numbering without emitting a stray "." for written steps.
    number_prefix: isNote ? '' : `${number}. `,
    // The voice this template was asked for. It was accepted as a parameter,
    // threaded all the way down here, and then never read - so every template
    // export came out in the engine's past tense regardless of what the
    // recording was for. A procedure handed to somebody then read as a report
    // of what one person once did rather than as instructions.
    description: oneLine(describe ? describe(step, voice) : toImperative(step, voice)),
    action: (step.action || '').toUpperCase(),
    window: oneLine(step.window && step.window.title),
    process: oneLine(step.window && step.window.process),
    target: oneLine(step.target && step.target.name),
    typed: oneLine(step.typed),
    image: rel,
    // Ready-made Markdown, so a template author does not have to know whether a
    // given step has a screenshot at all.
    image_block: rel ? `![Step ${number}](${rel})` : '',
    is_note: isNote ? 'true' : 'false',
  };
}

/**
 * Renders `templateText` for a session. Returns the document plus a report of
 * which hooks were filled and which were left untouched, so a template with a
 * typo in a hook name fails loudly rather than silently dropping content.
 */
function render(templateText, session, { title, imageDir = 'images', brand = null,
                                         docId: forcedId = null, userId = null,
                                         voice = 'imperative', legend = [] } = {}) {
  const allSteps = session.steps || [];
  const steps = allSteps.filter((s) => !s.excluded);
  const values = buildValues(session, steps, allSteps,
                             { title, brand, docId: forcedId, userId, legend });

  let out = templateText;
  const filledLoops = [];

  // Loops first: a loop body may itself contain INJECT_ hooks we should not
  // treat as document-level values.
  for (const loop of LOOPS) {
    const pattern = new RegExp(
      `<!--\\s*PARSER_HOOK:\\s*${loop.start}\\s*-->([\\s\\S]*?)<!--\\s*PARSER_HOOK:\\s*${loop.end}\\s*-->`,
      'g');

    out = out.replace(pattern, (whole, body) => {
      const hasPlaceholders = /\{\{\s*[a-z0-9_]+\s*\}\}/i.test(body);
      const row = hasPlaceholders ? body : DEFAULT_ROW[loop.kind];

      const source = loop.kind === 'gallery'
        ? steps.filter((s) => s.screenshot)
        : steps;

      let number = 0;
      // One tracker per loop: a gallery and a step list each start afresh.
      const describe = windowTracker();
      const rendered = source.map((step) => {
        if (step.action !== 'note') number += 1;
        return fillRow(row, stepVars(step, number, imageDir, voice, describe));
      }).join('');

      filledLoops.push({ hook: loop.start, rows: source.length,
                         usedTemplateBody: hasPlaceholders });
      return rendered;
    });
  }

  // Then the single-value hooks.
  const filled = [];
  const unknown = [];
  out = out.replace(HOOK, (whole, name) => {
    if (name in values) { filled.push(name); return oneLine(values[name]); }
    // Left exactly as found: an unrecognised hook is a template problem to
    // surface, not content to silently delete.
    unknown.push(name);
    return whole;
  });

  return { text: out, report: { filled, unknown, loops: filledLoops } };
}

/** Copies the screenshots a rendered template references. */
function copyImages(session, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  for (const step of (session.steps || []).filter((s) => !s.excluded)) {
    if (!step.screenshot) continue;
    const from = path.join(session.dir, step.screenshot);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(targetDir, path.basename(step.screenshot)));
    copied++;
  }
  return copied;
}

/** Hooks a template file declares, for validating one before it is used. */
function inspect(templateText) {
  const hooks = [...templateText.matchAll(HOOK)].map((m) => m[1]);
  const loops = LOOPS.filter((l) => hooks.includes(l.start) && hooks.includes(l.end));
  const unpaired = LOOPS.filter((l) =>
    (hooks.includes(l.start) !== hooks.includes(l.end)));
  return {
    hooks: [...new Set(hooks)],
    loops: loops.map((l) => l.start),
    unpaired: unpaired.map((l) => l.start),
  };
}

module.exports = { render, copyImages, inspect, redactionSummary };
