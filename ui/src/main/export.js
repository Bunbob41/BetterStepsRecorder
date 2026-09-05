const fs = require('node:fs');
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

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

function dataUri(file) {
  const ext = path.extname(file).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${fs.readFileSync(file).toString('base64')}`;
}

/** Steps that survive into a document; excluded ones never reach the reader. */
function exportable(session) {
  return (session.steps || []).filter((s) => !s.excluded);
}

/** Non-note steps, i.e. the ones that carry a number in the finished guide. */
const countSteps = (steps) => steps.filter((s) => s.action !== 'note').length;

/**
 * Where the click happened, as a percentage of the screenshot, so the marker
 * scales with the image at any width. Returns null when the point falls
 * outside the captured frame.
 */
function markerPosition(step) {
  // The captured frame, not the window: framing by monitor or full screen means
  // the screenshot is larger than the window and window-relative maths is wrong.
  const rect = (step.frame && step.frame.w ? step.frame : null)
            || (step.window && step.window.rect);
  if (!rect || !rect.w || !rect.h) return null;

  const x = ((step.point.x - rect.x) / rect.w) * 100;
  const y = ((step.point.y - rect.y) / rect.h) * 100;
  if (x < 0 || y < 0 || x > 100 || y > 100) return null;

  return { x, y };
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

function buildHtml(session, { title, embedImages = true, brand = null,
                             voice = 'imperative' }) {
  const steps = exportable(session);
  const generated = new Date().toLocaleString();

  let n = 0;
  const body = steps.map((step) => {
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
    const src = hasShot
      ? (embedImages ? dataUri(abs) : step.screenshot)
      : null;

    const marker = markerPosition(step);
    const markerHtml = marker
      ? `<span class="marker" style="left:${marker.x.toFixed(2)}%;top:${marker.y.toFixed(2)}%"></span>`
      : '';

    const context = [step.window && step.window.title, step.window && step.window.process]
      .filter(Boolean).map(escapeHtml).join(' — ');

    return `
    <li class="step">
      <div class="step-head">
        <span class="num">${i + 1}</span>
        <p class="text">${escapeHtml(toImperative(step, voice))}</p>
      </div>
      ${context ? `<p class="context">${context}</p>` : ''}
      ${src ? `<figure class="shot">
        <img src="${src}" alt="Step ${i + 1}" loading="lazy" />
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
  .note .num { background: var(--panel); color: var(--muted); border: 1px solid var(--line); }
  .note .text { font-style: italic; }
  .text { margin: 2px 0 0; font-size: 17px; }
  .context { margin: 6px 0 0 44px; color: var(--muted); font-size: 13px; }
  .shot { position: relative; margin: 14px 0 0 44px; display: inline-block; max-width: calc(100% - 44px); }
  .shot img {
    display: block; max-width: 100%; height: auto;
    border: 1px solid var(--line); border-radius: 8px;
  }
  .marker {
    position: absolute; width: 34px; height: 34px; margin: -17px 0 0 -17px;
    border: 3px solid var(--marker); border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(255,255,255,.6);
  }
  footer { color: var(--muted); font-size: 13px; margin-top: 40px; }
  @media print {
    body { padding: 0; background: #fff; color: #000; }
    .step { break-inside: avoid; page-break-inside: avoid; }
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
    <ol>${body}</ol>
    <footer>${brand && brand.footer
      ? escapeHtml(brand.footer) + ' &middot; '
      : ''}Recorded with Steps Recorder.</footer>
  </div>
</body>
</html>`;
}

function buildMarkdown(session, { title, imageDir, brand = null,
                                 voice = 'imperative' }) {
  const steps = exportable(session);
  const lines = [`# ${title}`, ''];
  if (brand && brand.name) lines.push(`*${brand.name}*`, '');
  lines.push(...['',
                 `${countSteps(steps)} step${countSteps(steps) === 1 ? '' : 's'}`, '']);

  let n = 0;
  steps.forEach((step) => {
    if (step.action === 'note') {
      lines.push(`> ${step.text || ''}`, '');
      return;
    }

    const i = n++;
    lines.push(`## ${i + 1}. ${toImperative(step, voice)}`, '');

    const context = [step.window && step.window.title, step.window && step.window.process]
      .filter(Boolean).join(' — ');
    if (context) lines.push(`*${context}*`, '');

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

module.exports = { buildHtml, buildMarkdown, copyImages, toImperative, exportable };
