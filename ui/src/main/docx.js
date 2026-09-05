const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

/**
 * Renders a recording into a Word template.
 *
 * Regulated industries do not run on Markdown. Their SOPs are .docx files with
 * a controlled letterhead, a revision table and a signature block, and the
 * template is usually something nobody is allowed to recreate - only fill in.
 * So the same rule as the Markdown engine applies, harder: the template is
 * read, never written, and we only put values where the author marked slots.
 *
 * Word cannot hold an HTML comment, so slots are written as text the author
 * types normally:
 *
 *   {{title}}                              a value
 *   {{FOR s IN steps}} ... {{END-FOR s}}   a repeated block
 *   {{IMAGE shot(s)}}                      that step's screenshot
 *
 * Word habitually splits a typed placeholder across several runs (a spell-check
 * mark or a stray format change is enough); docx-templates normalises runs
 * before matching, which is the main reason to use it rather than string
 * surgery on document.xml.
 */

const DEFAULT_IMAGE_WIDTH_CM = 14;

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
  let h = 0;
  for (const ch of session.dir) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `SOP-${stamp}-${h.toString(16).slice(0, 4).toUpperCase()}`;
}

/**
 * Builds the data a Word template can reference. Deliberately flat and boring:
 * whoever writes the template is a documentation author, not a programmer.
 */
function buildData(session, { title, brand, redactionSummary }) {
  const all = session.steps || [];
  const included = all.filter((s) => !s.excluded);
  const when = new Date();

  let number = 0;
  const steps = included.map((s) => {
    const isNote = s.action === 'note';
    if (!isNote) number += 1;
    return {
      number: isNote ? '' : String(number),
      // "3. " for a step and "" for a note, so a template can number without
      // emitting a stray full stop for written steps.
      label: isNote ? '' : `${number}. `,
      description: (s.text || '').replace(/\s*\n\s*/g, ' ').trim(),
      action: (s.action || '').toUpperCase(),
      window: (s.window && s.window.title) || '',
      process: (s.window && s.window.process) || '',
      target: (s.target && s.target.name) || '',
      typed: s.typed || '',
      isNote,
      hasImage: Boolean(s.screenshot),
      screenshot: s.screenshot || '',
    };
  });

  return {
    title: title || session.name || 'Recorded procedure',
    doc_id: docId(session, when),
    timestamp: when.toISOString(),
    date: when.toLocaleDateString(),
    target_app: dominantApp(included) || 'Not recorded',
    user_id: os.userInfo().username,
    os_environment: `${os.type()} ${os.release()}`,
    step_count: String(steps.filter((s) => !s.isNote).length),
    organisation: (brand && brand.name) || '',
    footer: (brand && brand.footer) || '',
    redaction_summary: redactionSummary,
    steps,
  };
}

/**
 * Fills `templatePath` and returns the finished document as a Buffer.
 * Screenshots are embedded, so the result is one file that survives being
 * emailed on its own.
 */
async function render(templatePath, session, opts = {}) {
  const { createReport } = require('docx-templates');
  const template = fs.readFileSync(templatePath);
  const data = buildData(session, opts);

  const widthCm = opts.imageWidthCm || DEFAULT_IMAGE_WIDTH_CM;
  const missing = [];

  const buffer = await createReport({
    template,
    data,
    cmdDelimiter: ['{{', '}}'],
    // Only what a template needs; nothing that would let a template file run
    // arbitrary work of its own.
    noSandbox: false,
    failFast: false,
    rejectNullish: false,
    additionalJsContext: {
      /** {{IMAGE shot(s)}} - that step's screenshot, sized to the page. */
      shot: (step) => {
        const rel = step && step.screenshot;
        if (!rel) return null;
        const abs = path.join(session.dir, rel);
        if (!fs.existsSync(abs)) { missing.push(rel); return null; }

        // A prepared copy wins over the file on disk: a recording of
        // photographic frames is hundreds of megabytes as PNG, and every byte
        // of it would go into this zip. The originals are never altered.
        const prepared = opts.images && opts.images.get(abs);
        const ext = prepared
          ? prepared.ext.replace('.', '')
          : (path.extname(abs).toLowerCase() === '.jpg' ? 'jpg' : 'png');
        const bytes = prepared ? prepared.data : fs.readFileSync(abs);
        const { width, height } = pngSize(bytes, ext);
        const ratio = width && height ? height / width : 0.6;

        return {
          width: widthCm,
          height: Number((widthCm * ratio).toFixed(2)),
          data: bytes,
          extension: `.${ext}`,
        };
      },
    },
  });

  return { buffer: Buffer.from(buffer), data, missing };
}

/** Intrinsic size, so a screenshot is not stretched into the wrong aspect. */
function pngSize(bytes, ext) {
  try {
    if (ext === 'png' && bytes.length > 24 && bytes.toString('latin1', 1, 4) === 'PNG') {
      return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    }
    // JPEG: walk the segments to the first frame header.
    let i = 2;
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue; }
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  } catch { /* fall through to the default ratio */ }
  return { width: 0, height: 0 };
}

/** The placeholders a .docx template actually uses, for validating one. */
async function inspect(templatePath) {
  const JSZip = require('jszip');
  const zip = await JSZip.loadAsync(fs.readFileSync(templatePath));
  const doc = zip.file('word/document.xml');
  if (!doc) return { hooks: [], loops: [], images: 0, readable: false };

  // Strip tags first: Word splits a typed placeholder across runs, so the
  // markers are only contiguous once the XML is removed.
  const text = (await doc.async('string')).replace(/<[^>]+>/g, '');
  const found = [...text.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1].trim());

  return {
    readable: true,
    hooks: [...new Set(found.filter((h) => !/^(FOR|END-FOR|IMAGE|IF|END-IF)\b/i.test(h)))],
    loops: found.filter((h) => /^FOR\b/i.test(h)),
    images: found.filter((h) => /^IMAGE\b/i.test(h)).length,
  };
}

module.exports = { render, inspect, buildData };
