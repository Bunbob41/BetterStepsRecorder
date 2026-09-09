const fs = require('node:fs');
const marker = require('../renderer/marker');
const sections = require('../renderer/sections');
const appName = require('../renderer/appname');
const annotate = require('../renderer/annotate');
const path = require('node:path');

/**
 * Turns a recording into something someone else can read.
 *
 * The capture engine writes a past-tense log ("Clicked the Save button"),
 * because that is what happened. A procedure is written in the imperative
 * ("Click the Save button"), because the reader has not done it yet. That
 * transform belongs here rather than in the engine: the recording is a record,
 * the export is instructions.
 */

const IMPERATIVE = [
  [/^Clicked\b/, 'Click'],
  [/^Right-clicked\b/, 'Right-click'],
  [/^Double-clicked\b/, 'Double-click'],
  [/^Dragged\b/, 'Drag'],
  [/^Typed\b/, 'Type'],
  [/^Pressed\b/, 'Press'],
  [/^Entered password\b/, 'Enter your password'],
  [/^Interacted with\b/, 'Interact with'],
];

/**
 * `voice` is decided when the recording starts, not here. A procedure tells the
 * reader what to do ("Click Save"); an evidence record states what was done
 * ("Clicked the Save button"), and rewriting that into an instruction would
 * misrepresent what the document is.
 */
function toImperative(step, voice = 'imperative') {
  const text = step.text || step.action || '';
  // Wording the user rewrote is theirs; do not second-guess it.
  if (step.textEdited || voice === 'past') return text;

  for (const [pattern, replacement] of IMPERATIVE) {
    if (pattern.test(text)) return text.replace(pattern, replacement);
  }
  return text;
}

/**
 * A running note of which window the reader is in.
 *
 * The engine names the window on every step, because every step has to be true
 * on its own: steps can be reordered, excluded and re-recorded individually, so
 * one that meant "the window mentioned two steps ago" would quietly break the
 * moment anything moved. That is right for the record and wrong for the
 * document - in one recording the window title was 69% of all the description
 * text, the same 60 characters repeated 103 times.
 *
 * So the title is dropped at RENDER time, where the final order and the final
 * set of included steps are both known, and only when the previous rendered
 * step was already in that window. It is said once, and again whenever it
 * changes.
 */
function windowTracker() {
  let current = null;

  function describe(step, voice) {
    const text = toImperative(step, voice);
    const title = (step.window && step.window.title) || '';

    // A written note belongs to wherever the reader already is; it neither
    // states a window nor moves the reader out of one.
    if (step.action === 'note' || !title) return text;

    const repeated = title === current;
    current = title;
    describe.changed = !repeated;
    if (!repeated) return text;

    // Only the trailing clause, and only when it is exactly this window: a
    // title quoted mid-sentence is part of what was clicked, not context.
    const suffix = ` in "${title}"`;
    return text.endsWith(suffix) ? text.slice(0, -suffix.length) : text;
  }

  // A note neither states a window nor moves out of one, so it leaves this
  // alone; anything with no window of its own is not a change either.
  describe.changed = true;
  return describe;
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Steps that survive into a document; excluded ones never reach the reader. */
function exportable(session) {
  // Headings last, so a section whose every step was excluded goes with them.
  return sections.withoutEmpty(
    (session.steps || []).filter((s) => !s.excluded));
}

/** The rows that carry a number: not notes, not headings. */
const countSteps = sections.countSteps;

/**
 * Where the click happened, as a percentage of the screenshot, so the marker
 * scales with the image at any width. Returns null when the point falls
 * outside the captured frame.
 */
function markerPosition(step, opts) {
  return marker.positionFor(step, opts);
}


/** A logo, embedded so the document stays a single portable file. */
function logoTag(brand) {
  if (!brand || !brand.logo) return '';
  try {
    if (!fs.existsSync(brand.logo)) return '';
    const ext = path.extname(brand.logo).toLowerCase();
    const mime = ext === '.svg' ? 'image/svg+xml'
               : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
               : ext === '.gif' ? 'image/gif' : 'image/png';
    const data = fs.readFileSync(brand.logo).toString('base64');
    return `<img class="logo" src="data:${mime};base64,${data}" alt="" />`;
  } catch {
    // A missing or unreadable logo must never cost someone their export.
    return '';
  }
}

/**
 * `imageSrc` decides what each step's <img src> becomes: a data URI, or a
 * relative path when the screenshots are too large to embed. It is injected
 * because the decision needs an image encoder, and this module deliberately
 * has no Electron dependency so it can be tested with plain node.
 */
/**
 * The key, in plain text, for a format that has no styling of its own.
 *
 * A colour used without a meaning still appears, saying so: a mark on the page
 * that the key does not explain is exactly what a key exists to prevent.
 */
function legendLines(legend) {
  return (legend || []).map((h) =>
    `${h.name} — ${h.meaning || 'no meaning set'}`);
}

function buildHtml(session, { title, embedImages = true, brand = null,
                             voice = 'imperative', imageSrc = null,
                             markerOpts = {}, legend = [] }) {
  const steps = exportable(session);
  const generated = new Date().toLocaleString();

  let n = 0;
  const describe = windowTracker();
  const body = steps.map((step) => {
    if (sections.isSection(step)) {
      // Inside the <ol> rather than breaking the list in two, so the step
      // numbering runs continuously across sections: someone who says "I am
      // stuck on step 9" means the ninth step of the procedure, and four
      // separate lists would give a document four step 3s.
      return `
    <li class="section"><h2>${escapeHtml(step.text || '')}</h2></li>`;
    }

    if (step.action === 'note') {
      // An authored aside, not something that was clicked.
      return `
    <li class="step note">
      <div class="step-head">
        <span class="num note-num">&bull;</span>
        <p class="text">${escapeHtml(step.text || '')}</p>
      </div>
    </li>`;
    }

    const i = n++;
    const abs = path.join(session.dir, step.screenshot || '');
    const hasShot = step.screenshot && fs.existsSync(abs);
    const src = !hasShot ? null
      : imageSrc ? imageSrc(abs)
      : embedImages ? dataUri(abs)
      : step.screenshot;

    // Laid over the picture rather than drawn into it, exactly as the window
    // shows them and from the same code. A .docx cannot do this, which is why
    // it takes the other route entirely - see composite.js.
    const size = annotate.sizeOf(step);
    const marksSvg = annotate.svgAll(step.marks, size.w, size.h);
    const marksHtml = marksSvg ? `<div class="bsr-marks">${marksSvg}</div>` : '';

    const at = markerPosition(step, markerOpts);
    // The step's own angle, if it has been turned, over the shared options.
    const markerHtml = at
      ? marker.html(at, Number.isFinite(step.markerAngle)
                          ? { ...markerOpts, angle: step.markerAngle }
                          : markerOpts)
      : '';

    // The process only: the description already names the window at exactly the
    // points this caption appears, so repeating the title here said the same
    // thing twice on the same line.
    const context = escapeHtml(
      appName.friendly(step.window && step.window.process,
                       step.window && step.window.product));

    return `
    <li class="step">
      <div class="step-head">
        <span class="num">${i + 1}</span>
        <p class="text">${escapeHtml(describe(step, voice))}</p>
      </div>
      ${context && describe.changed ? `<p class="context">${context}</p>` : ''}
      ${src ? `<figure class="shot">
        <img src="${src}" alt="Step ${i + 1}" loading="lazy" />
        ${marksHtml}
        ${markerHtml}
      </figure>` : ''}
    </li>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root {
    --ink: #1a1c20; --muted: #5c636e; --line: #dfe3e8;
    --accent: #1f6feb; --marker: #e5484d; --bg: #ffffff; --panel: #f6f7f9;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --ink: #e6e8ec; --muted: #9aa1ad; --line: #33373f;
      --accent: #6ea8ff; --bg: #16171b; --panel: #1d1f25;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 24px; background: var(--bg); color: var(--ink);
    font: 16px/1.6 "Segoe UI", system-ui, -apple-system, sans-serif;
  }
  .wrap { max-width: 900px; margin: 0 auto; }
  .head { display: flex; align-items: center; gap: 16px; }
  .logo { max-height: 52px; max-width: 200px; width: auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .brand { margin: 0; color: var(--muted); font-size: 14px; }
  .meta { color: var(--muted); font-size: 14px; margin: 0 0 32px; }
  ol { list-style: none; margin: 0; padding: 0; counter-reset: step; }
  .step { margin: 0 0 40px; padding: 0 0 32px; border-bottom: 1px solid var(--line); }
  .step:last-child { border-bottom: 0; }
  .step-head { display: flex; gap: 14px; align-items: flex-start; }
  .num {
    flex: none; width: 30px; height: 30px; border-radius: 50%;
    background: var(--accent); color: #fff; font-size: 15px; font-weight: 600;
    display: grid; place-items: center;
  }
  .section { margin: 44px 0 24px; padding: 0; border-bottom: 0; }
  .section:first-child { margin-top: 0; }
  .section h2 {
    margin: 0; font-size: 20px; letter-spacing: .01em;
    padding-bottom: 8px; border-bottom: 2px solid var(--accent);
  }
  /* The step above a heading needs no rule of its own - the heading is already
     the divider, and two lines a few pixels apart is just noise. Older browsers
     without :has() simply keep the rule, which is what the page looked like
     before headings existed. */
  .step:has(+ .section) { border-bottom: 0; }
  .note .num { background: var(--panel); color: var(--muted); border: 1px solid var(--line); }
  .note .text { font-style: italic; }
  .text { margin: 2px 0 0; font-size: 17px; }
  .context { margin: 6px 0 0 44px; color: var(--muted); font-size: 13px; }
  /* An arrow's tail can be longer than a small screenshot; clip it to the
     picture rather than letting it hang outside. */
  .shot { position: relative; margin: 14px 0 0 44px; display: inline-block;
          max-width: calc(100% - 44px); overflow: hidden; border-radius: 8px; }
  .shot img {
    display: block; max-width: 100%; height: auto;
    border: 1px solid var(--line); border-radius: 8px;
  }
  .bsr-marker svg { display: block; }
  /* Over the picture, and never in the way of selecting the text under it. */
  .bsr-marks { position: absolute; inset: 0; pointer-events: none; }
  .bsr-marks svg { width: 100%; height: 100%; display: block; }
  .legend {
    margin: 0 0 32px; padding: 14px 16px;
    background: var(--panel); border: 1px solid var(--line); border-radius: 8px;
  }
  .legend-title { font-weight: 600; margin-bottom: 8px; }
  .legend dd { margin: 0 0 4px; display: flex; align-items: center; gap: 9px; }
  .legend .swatch {
    width: 16px; height: 16px; border-radius: 3px; flex: none;
    border: 1px solid var(--line);
  }
  footer { color: var(--muted); font-size: 13px; margin-top: 40px; }
  @media print {
    body { padding: 0; background: #fff; color: #000; }
    .step { break-inside: avoid; page-break-inside: avoid; }
    /* A heading alone at the foot of a page announces a phase that is not
       there. These guides get printed and put in folders. */
    .section { break-after: avoid; page-break-after: avoid; break-inside: avoid; }
    .shot img { border-color: #ccc; }
  }
</style>
</head>
<body>
  <div class="wrap">
    <header class="head">
      ${logoTag(brand)}
      <div>
        <h1>${escapeHtml(title)}</h1>
        ${brand && brand.name ? `<p class="brand">${escapeHtml(brand.name)}</p>` : ''}
      </div>
    </header>
    <p class="meta">${countSteps(steps)} step${countSteps(steps) === 1 ? '' : 's'} · ${escapeHtml(generated)}</p>
    ${legend.length ? `<dl class="legend">
      <dt class="legend-title">What the highlighting means</dt>
      ${legend.map((h) => `<dd><span class="swatch" style="background:${h.fill}"></span>${
        escapeHtml(h.name)} — ${escapeHtml(h.meaning || 'no meaning set')}</dd>`).join('')}
    </dl>` : ''}
    <ol>${body}</ol>
    <footer>${brand && brand.footer
      ? escapeHtml(brand.footer) + ' &middot; '
      : ''}Recorded with Steps Recorder.</footer>
  </div>
</body>
</html>`;
}

function buildMarkdown(session, { title, imageDir, brand = null,
                                 voice = 'imperative', legend = [] }) {
  const steps = exportable(session);
  const lines = [`# ${title}`, ''];
  if (brand && brand.name) lines.push(`*${brand.name}*`, '');
  lines.push(...['',
                 `${countSteps(steps)} step${countSteps(steps) === 1 ? '' : 's'}`, '']);

  if (legend.length) {
    lines.push('**What the highlighting means**', '');
    for (const line of legendLines(legend)) lines.push(`* ${line}`);
    lines.push('');
  }

  // Steps drop a level when the guide has headings, so a wiki's contents list
  // shows the phases with their steps beneath rather than forty flat entries.
  // A guide without headings is untouched.
  const stepRule = sections.hasSections(steps) ? '###' : '##';

  let n = 0;
  const describe = windowTracker();
  steps.forEach((step) => {
    if (sections.isSection(step)) {
      lines.push(`## ${step.text || ''}`, '');
      return;
    }

    if (step.action === 'note') {
      lines.push(`> ${step.text || ''}`, '');
      return;
    }

    const i = n++;
    lines.push(`${stepRule} ${i + 1}. ${describe(step, voice)}`, '');

    const context = appName.friendly(step.window && step.window.process,
                                     step.window && step.window.product);
    // Only when the window changed: repeating it under every step is the same
    // noise the description just stopped carrying.
    if (context && describe.changed) lines.push(`*${context}*`, '');

    if (step.screenshot && fs.existsSync(path.join(session.dir, step.screenshot))) {
      // Relative path so the document works in a git wiki or a docs folder.
      lines.push(`![Step ${i + 1}](${imageDir}/${path.basename(step.screenshot)})`, '');
    }
  });

  if (brand && brand.footer) lines.push('---', '', brand.footer, '');
  return lines.join('\n');
}

/** Copies the screenshots a Markdown export references alongside it. */
function copyImages(session, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  let copied = 0;
  // Excluded steps are not in the document, so their images must not travel
  // with it - copying them would defeat the point of excluding them.
  for (const step of exportable(session)) {
    if (!step.screenshot) continue;
    const from = path.join(session.dir, step.screenshot);
    if (!fs.existsSync(from)) continue;
    fs.copyFileSync(from, path.join(targetDir, path.basename(step.screenshot)));
    copied++;
  }
  return copied;
}

module.exports = { buildHtml, buildMarkdown, copyImages, toImperative,
                   exportable, windowTracker, legendLines, markerPosition };
