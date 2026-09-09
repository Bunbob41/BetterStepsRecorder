/**
 * Compiles the LaTeX export with a real TeX engine.
 *
 * `latex_test.js` checks the fragment lexically - characters escaped,
 * environments balanced, a hostile title coming out inert. That is not a
 * compiler, and this project has been caught by exactly that distinction
 * before: the diagram that parsed cleanly under two versions of Mermaid and
 * rendered as an error box on GitHub (D-48). The authoritative renderer is the
 * one the reader uses.
 *
 * So this one hands the output to pdfTeX and asks. It builds a recording whose
 * text contains every character TeX reserves - as a file path, a percentage, a
 * price, a formula - wraps the fragment in the smallest document that could
 * receive it, and compiles. A single unescaped backslash fails the build; a
 * character escaped into something the font has no glyph for is a "Missing
 * character" line in the log, which is checked too because it prints NOTHING
 * on the page and is otherwise invisible.
 *
 * SKIPS when no engine is installed, and says so rather than passing quietly.
 * A skipped check is not a passed one, and a suite that hides the difference is
 * worse than no suite.
 *
 *   TinyTeX:   https://yihui.org/tinytex/    (about 100MB, unpacks to one folder)
 *   or any TeX Live / MiKTeX with pdflatex on PATH.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLatex } = require('../ui/src/main/latex');

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  c ? (pass++, console.log('  PASS ' + n))
    : (fail++, console.log('  FAIL ' + n + (extra ? `\n        ${extra}` : '')));
};

/** pdflatex, wherever this machine keeps it. */
function findEngine() {
  const onPath = spawnSync(process.platform === 'win32' ? 'where' : 'which',
                           ['pdflatex'], { encoding: 'utf8' });
  if (onPath.status === 0) {
    const first = (onPath.stdout || '').split(/\r?\n/).find(Boolean);
    if (first && fs.existsSync(first)) return first;
  }
  // TinyTeX puts itself in one folder per platform and does not touch PATH
  // unless it is asked to.
  const home = os.homedir();
  const candidates = [
    path.join(process.env.APPDATA || '', 'TinyTeX', 'bin', 'windows', 'pdflatex.exe'),
    path.join(home, 'Library', 'TinyTeX', 'bin', 'universal-darwin', 'pdflatex'),
    path.join(home, '.TinyTeX', 'bin', 'x86_64-linux', 'pdflatex'),
  ];
  return candidates.find((c) => c && fs.existsSync(c)) || null;
}

const engine = findEngine();
if (!engine) {
  console.log('no TeX engine on this machine - the fragment was NOT compiled.');
  console.log('install TinyTeX (https://yihui.org/tinytex/) to run this check.');
  console.log('\n0 passed, 0 failed');
  process.exit(0);
}
console.log(`compiling with ${engine}`);

// The same 1x1 PNG the other suites use. \includegraphics needs a real file
// and nothing here looks at it, but it does have to be a VALID one: pdfTeX
// meets a malformed PNG by crashing - no error, no message, a truncated log
// and an exit code Windows uses for an invalid handle. An hour went into
// reading that as a fault in the fragment.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');

const dir = path.join(os.tmpdir(), 'bsr-tex-compile-' + Date.now());
fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
fs.writeFileSync(path.join(dir, 'images', 'shot.png'), PNG);

const B = String.fromCharCode(92);
const w = (title) => ({ title, process: 'app.exe', rect: { x: 0, y: 0, w: 8, h: 6 } });

// Every reserved character, in the shape it actually turns up in: a Windows
// path, a percentage, a price, a formula, a control name in quotes.
const session = {
  dir,
  steps: [
    { id: '1', action: 'keyText',
      text: 'Typed "C:' + B + 'Users' + B + 'me' + B + 'q3_report #4.txt" into the "File name" field',
      point: { x: 4, y: 3 }, window: w('Save As'), screenshot: 'images/shot.png' },
    { id: 'n', action: 'note',
      text: 'Margin must be 50% & the total under $1,000 ~ check x^2 first', textEdited: true },
    { id: 'h', action: 'section', text: 'Approving it {finally}' },
    { id: '2', action: 'leftClick', text: 'Clicked "Approve & post" in <Ledger>',
      point: { x: 4, y: 3 }, window: w('Ledger | Q3'), screenshot: 'images/shot.png' },
  ],
};

const fragment = buildLatex(session, {
  title: 'Filing a 50% claim & closing it',
  imageDir: 'images',
  imageRef: (s) => (s.screenshot ? 'images/shot.png' : null),
});
fs.writeFileSync(path.join(dir, 'fragment.tex'), fragment, 'utf8');

// The smallest document that could receive it: article, and the one package
// the fragment says it assumes. Nothing else, so a bare TeX install is enough
// and a failure means the FRAGMENT, not the wrapper.
fs.writeFileSync(path.join(dir, 'doc.tex'),
  [String.raw`\documentclass{article}`,
   String.raw`\usepackage{graphicx}`,
   String.raw`\begin{document}`,
   String.raw`\section{Procedures}`,
   String.raw`\input{fragment}`,
   String.raw`\end{document}`, ''].join('\n'), 'utf8');

const run = spawnSync(engine,
                      ['-interaction=nonstopmode', '-halt-on-error', 'doc.tex'],
                      { cwd: dir, encoding: 'utf8', timeout: 180000 });

const log = fs.existsSync(path.join(dir, 'doc.log'))
  ? fs.readFileSync(path.join(dir, 'doc.log'), 'utf8') : (run.stdout || '');

// The line pdfTeX prints for an error starts with "! ", and -halt-on-error
// means the first one is also the last.
const errors = log.split('\n').filter((l) => l.startsWith('! '));
check('the fragment compiles', run.status === 0 && errors.length === 0,
      errors.slice(0, 3).join('\n        ') || `exit ${run.status}`);
check('and produces a PDF', fs.existsSync(path.join(dir, 'doc.pdf')));

// A character escaped into something the font cannot set prints nothing at all.
// No error, no warning anyone reads - just a hole in somebody's manual.
const missing = log.split('\n').filter((l) => /Missing character/.test(l));
check('with no character silently dropped', missing.length === 0,
      missing.slice(0, 3).join('\n        '));

// Pages, as the engine itself counts them.
//
// Looking for "/Page" in the bytes does not work and quietly passes nothing:
// pdfTeX writes its page objects into an object STREAM, compressed, so the
// string is not in the file even though the pages are. The engine says what it
// wrote, so ask it rather than guessing from the bytes.
const written = log.match(/Output written on doc\.pdf \((\d+) pages?, (\d+) bytes\)/);
check('and the engine reports pages written',
      Boolean(written) && Number(written[1]) >= 1 && Number(written[2]) > 1000,
      written ? written[0] : 'no "Output written" line in the log');
check('as many pages as a document with two figures in it needs',
      Boolean(written) && Number(written[1]) >= 1);

// Compiled twice, because a fragment carries \label and \caption: the first
// pass writes the .aux, the second resolves it. An undefined reference here
// would mean the labels this export writes do not resolve in a real document.
const second = spawnSync(engine,
                         ['-interaction=nonstopmode', '-halt-on-error', 'doc.tex'],
                         { cwd: dir, encoding: 'utf8', timeout: 180000 });
const log2 = fs.readFileSync(path.join(dir, 'doc.log'), 'utf8');
check('a second pass settles the references', second.status === 0
      && !/Warning: There were undefined references/.test(log2),
      log2.split('\n').filter((l) => /undefined/i.test(l)).slice(0, 3).join('\n        '));

fs.rmSync(dir, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
