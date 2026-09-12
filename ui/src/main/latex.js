/**
 * A recording as LaTeX, for pasting into a manual that already exists.
 *
 * The people who asked for this write their manuals in Overleaf: one book-sized
 * `article` document, per-team, with its own preamble, its own packages and its
 * own house style. What they need from a recording is the PROCEDURE - a
 * subsection, a numbered list, and the screenshots interleaved - to drop into
 * chapter six between two things they wrote by hand.
 *
 * So this produces a FRAGMENT, and that word decides nearly everything below:
 *
 * - No `\documentclass`, no preamble, no `\begin{document}`. A complete
 *   document would have to be taken apart before it could be used, and the
 *   parts thrown away are exactly the parts their manual already has.
 * - No `\usepackage`. A fragment cannot add packages: it is pasted into the
 *   body, long after the preamble has been read. `graphicx` is assumed, on the
 *   grounds that a manual with figures in it already loads it, and the header
 *   comment says so plainly rather than letting them find out from an error.
 * - Nothing is styled. No fonts, no colours, no margins, no `\setlength`. The
 *   document it lands in has all of that decided, and a fragment that argued
 *   with it would be worse than useless.
 *
 * Everything a reader will see comes off somebody's screen - window titles,
 * typed text, file names - so every character of it goes through `escape()`.
 * That is not tidiness. A window title containing a backslash is enough to
 * break the build; one containing `\input{...}` is enough to pull a file the
 * author never named into their document.
 */
const fs = require('node:fs');
const path = require('node:path');
const {
  exportable, toImperative, windowTracker, legendLines,
} = require('./export');
const sections = require('../renderer/sections');
const appName = require('../renderer/appname');

/**
 * The ten characters TeX reserves, plus four that are legal but come out wrong.
 *
 * `\ { } $ & # _ % ~ ^` are the reserved ones. `< > |` are not reserved and
 * need no escape, but in the OT1 encoding a manual in Computer Modern still
 * uses they render as inverted punctuation and a dash - so "press <Enter>"
 * would print as press ¡Enter¿. Left as themselves they are a silent typo in
 * somebody's manual, which is worse than a build error because nobody catches
 * it.
 */
const RESERVED = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  $: '\\$',
  '&': '\\&',
  '#': '\\#',
  _: '\\_',
  '%': '\\%',
  '~': '\\textasciitilde{}',
  '^': '\\textasciicircum{}',
  '<': '\\textless{}',
  '>': '\\textgreater{}',
  '|': '\\textbar{}',
};

/**
 * One pass, so nothing is escaped twice.
 *
 * A backslash becomes `\textbackslash{}`, which contains braces; escaping in
 * two passes would turn those braces into `\{\}` and print the replacement
 * instead of performing it.
 */
function escape(text) {
  const escaped = String(text ?? '').replace(/[\\{}$&#_%~^<>|]/g, (c) => RESERVED[c]);

  // Straight quotes, opened and closed.
  //
  // TeX prints " as a CLOSING quote wherever it appears, so `Click the "Save"
  // button` comes out with two closing quotes and reads as a mistake in a
  // typeset manual. Nearly every step the engine writes quotes a control name,
  // so this is not an edge case - it is most of the document.
  //
  // Alternating within one string is safe because a step's text is one short
  // sentence with balanced quotes in it. A stray odd quote opens and never
  // closes, which is a typographical wart and not a build error.
  let open = false;
  return escaped.replace(/"/g, () => {
    open = !open;
    return open ? '``' : "''";
  });
}

/** A label anyone can type: ASCII, no spaces, nothing TeX has to interpret. */
function slugify(text, fallback = 'steps') {
  const s = String(text || '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return s || fallback;
}

/**
 * Turns a recording into a `\subsection` somebody can paste - or, with
 * `standalone`, into a document that compiles on its own.
 *
 * `imageRef(step)` gives the path to write into `\includegraphics`, relative to
 * the `.tex` file, or null for a step with no picture. It is a hook for the
 * same reason the HTML export has one: what the file is called depends on
 * whether it was re-encoded and marked on the way out, and that is the calling
 * side's business, not this one's.
 */
function buildLatex(session, { title, voice = 'imperative', legend = [],
                               imageRef = () => null, inputName = null,
                               standalone = false,
                               imageDir = null, width = 0.85 } = {}) {
  const steps = exportable(session);
  const slug = slugify(title);
  const out = [];

  // A header in comments, because a fragment has nowhere else to say anything.
  // It survives being pasted, and it is the only place these two facts can be
  // put in front of the person who needs them.
  out.push(`% ${escape(title)} - recorded with Steps Recorder.`);
  out.push('%');

  if (standalone) {
    // A document, not a fragment: it owns its class, its margins and its
    // packages, and there is nothing to paste it into.
    out.push('% A COMPLETE DOCUMENT: it compiles on its own, with nothing around it.');
    if (imageDir) out.push(`% Upload it together with ./${imageDir}/ - the pictures live there.`);
    out.push('% In Overleaf, set this as the main document if the project has more than one.');
    out.push('');
    out.push('\\documentclass[11pt,a4paper]{article}');
    out.push('\\usepackage[T1]{fontenc}');
    out.push('\\usepackage[margin=2.5cm]{geometry}');
    out.push('\\usepackage{graphicx}');
    // Pinned rather than floating. In a procedure the picture belongs beside the
    // step it is about, and a figure that drifts onto the next page is worse
    // than one that leaves white space. A fragment cannot do this - `float` has
    // to be loaded in a preamble it does not own - which is why its own header
    // explains how to turn it on.
    out.push('\\usepackage{float}');
    out.push('');
    out.push(`\\title{${escape(title)}}`);
    out.push('\\date{}');
    out.push('');
    out.push('\\begin{document}');
    out.push('\\maketitle');
    out.push('');
  } else {
    out.push('% A FRAGMENT: paste it into your document, inside \\begin{document}.');
    out.push('% It declares no class and loads no packages - yours already has them.');
    out.push('%');
    out.push('% Assumes \\usepackage{graphicx} in your preamble.');
    if (imageDir) out.push(`% Screenshots are in ./${imageDir}/ - upload that folder too.`);
    if (inputName) {
      // The step everything else depends on, and the one nobody thinks to
      // mention. Watched for real: both files uploaded to Overleaf, graphicx
      // already in the preamble, and nothing appeared - because no line in the
      // document included this file. A fragment cannot include itself, so the
      // least it can do is say how.
      //
      // Quoted when the name has a space in it: \input{my guide} is an error,
      // and the name comes from whatever the file was saved as.
      const called = /\s/.test(inputName) ? `"${inputName}"` : inputName;
      out.push(`% To include it without pasting: \\input{${called}}`);
    }
    out.push('% Figures are floats [htbp]. To pin each one exactly where it appears,');
    out.push('% add \\usepackage{float} to your preamble and change [htbp] to [H].');
    out.push('');

    // The procedure is a subsection of somebody else's document, and its label
    // goes with that heading. A document of its own has a title block instead,
    // and a label with no sectioning command to attach to is a dangling
    // reference, so it does not get one.
    out.push(`\\subsection{${escape(title)}}`);
    out.push(`\\label{sec:${slug}}`);
    out.push('');
  }

  if (legend.length) {
    out.push('\\noindent\\textbf{What the highlighting means}');
    out.push('\\begin{itemize}');
    for (const line of legendLines(legend)) out.push(`  \\item ${escape(line)}`);
    out.push('\\end{itemize}');
    out.push('');
  }

  // The list is opened and closed repeatedly: a heading or a note between two
  // steps cannot live inside an enumerate without becoming an item of it. The
  // step numbers carry on across the break by hand, because they are the same
  // numbers the app shows and the HTML export prints - a procedure whose steps
  // restart at 1 halfway down is a different document.
  let open = false;
  let n = 0;
  const openList = () => {
    out.push('\\begin{enumerate}');
    if (n) out.push(`\\setcounter{enumi}{${n}}`);
    open = true;
  };
  const closeList = () => {
    if (!open) return;
    out.push('\\end{enumerate}');
    out.push('');
    open = false;
  };

  const describe = windowTracker();

  for (const step of steps) {
    if (sections.isSection(step)) {
      closeList();
      // One level down from the procedure itself, so a recording with phases in
      // it nests correctly wherever the subsection is pasted - and one level up
      // in a document of its own, where the procedure IS the document rather
      // than a subsection of one.
      out.push(`\\${standalone ? 'section' : 'subsubsection'}{${escape(step.text || '')}}`);
      out.push('');
      continue;
    }

    if (step.action === 'note') {
      closeList();
      out.push('\\begin{quote}');
      out.push(`  ${escape(step.text || '')}`);
      out.push('\\end{quote}');
      out.push('');
      continue;
    }

    if (!open) openList();
    const text = describe(step, voice);
    n += 1;
    out.push(`  \\item ${escape(text)}`);

    // Only when the window changed, the same rule every other export follows.
    const context = appName.friendly(step.window && step.window.process,
                                     step.window && step.window.product);
    if (context && describe.changed) {
      out.push(`  \\par\\emph{${escape(context)}}`);
    }

    const ref = imageRef(step);
    if (ref) {
      out.push(`  \\begin{figure}[${standalone ? 'H' : 'htbp'}]`);
      out.push('    \\centering');
      out.push(`    \\includegraphics[width=${width}\\linewidth]{${ref}}`);
      // Not the instruction again. Repeating the item's own sentence directly
      // under it reads as a mistake on the page - it was tried, and it looks
      // like the document has a fault in it. The title and the number are what
      // a List of Figures entry and a "see Figure 12" need in order to be
      // worth anything.
      out.push(`    \\caption{${escape(title)}, step ${n}}`);
      out.push(`    \\label{fig:${slug}-${n}}`);
      out.push('  \\end{figure}');
    }
  }

  closeList();
  if (standalone) {
    out.push('');
    out.push('\\end{document}');
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * What each screenshot is called in the folder, and the bytes that belong there.
 *
 * Split out from writing them because there are two places they can go now: a
 * folder beside the document, and a zip. The NAME is the join between the
 * document's `\includegraphics` paths and the files, so it is decided here,
 * once, and both destinations are handed the answer. Two implementations of it
 * would drift, and the drift would show as empty boxes in somebody's manual
 * rather than as an error.
 *
 * LaTeX has no embedded image: `\includegraphics` names a file, and that file
 * has to be somewhere the compiler can find it - so unlike HTML this export is
 * always a document plus a folder, and Overleaf takes the folder, or a zip with
 * the folder inside it (D-77).
 *
 * A screenshot re-encoded on the way out is a .jpg with a .png name in the
 * recording, and a document that referred to it by its original extension would
 * compile with every figure missing - a stack of empty boxes in somebody's
 * manual, not an error anyone here would see.
 */
function gatherImages({ files, images }) {
  const names = new Map();   // screenshot on disk -> what it is called in the folder
  const bytes = new Map();   // what it is called -> what to write there

  for (const file of files) {
    const encoded = images && images.get(file);
    const name = path.basename(file, path.extname(file))
               + (encoded ? encoded.ext : path.extname(file));
    names.set(file, name);
    // Two steps can share a screenshot (D-47). One file in the folder, named
    // once and read once - not the same bytes twice under two names.
    if (!bytes.has(name)) {
      bytes.set(name, encoded ? encoded.data : fs.readFileSync(file));
    }
  }

  return { names, bytes };
}

function writeImages({ files, images, dir, gathered = null }) {
  fs.mkdirSync(dir, { recursive: true });
  const { names, bytes } = gathered || gatherImages({ files, images });
  for (const [name, data] of bytes) fs.writeFileSync(path.join(dir, name), data);
  return names;
}

module.exports = { buildLatex, escape, slugify, gatherImages, writeImages };
