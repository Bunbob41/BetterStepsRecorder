/**
 * The LaTeX fragment export.
 *
 * Two things are being checked here and they are different in kind.
 *
 * The first is ESCAPING, and it is the whole reason this format is riskier than
 * the others. Every other exporter writes into a container that treats unknown
 * text as text: an HTML entity is a display bug at worst. TeX has no such
 * container - a bare backslash in a window title is a command, and the document
 * either fails to build or quietly does something nobody asked for. So the
 * escaping is checked character by character, and against a title written to
 * look like an attack, because a window title is text off somebody's screen and
 * this project has been bitten by exactly that before.
 *
 * The second is STRUCTURE: that what comes out is a fragment and not a
 * document, that its environments balance, and that the step numbers survive a
 * heading in the middle. A LaTeX file that does not balance is not a
 * document that looks wrong, it is a build that fails.
 *
 * What this canNOT check is whether the output compiles. There is no TeX engine
 * on this machine, and a lexical check is not a compiler - the same gap D-48
 * ran into with Mermaid, where the local parser accepted what GitHub refused.
 * Read the checks below as "this is well-formed by the rules we know", not as
 * "this builds".
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildLatex, escape, slugify, writeImages } = require('../ui/src/main/latex');

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  c ? (pass++, console.log('  PASS ' + n))
    : (fail++, console.log('  FAIL ' + n + (extra ? ` — ${extra}` : '')));
};

const B = String.fromCharCode(92);   // one backslash, out of the shell's reach

const win = (title) => ({ title, process: 'app.exe',
                          rect: { x: 0, y: 0, w: 800, h: 600 } });

const session = {
  dir: path.join('C:', 'fake', 'session'),
  steps: [
    { id: 'a', seq: 1, action: 'leftClick', text: 'Clicked the "Save" button in "Billing"',
      point: { x: 100, y: 100 }, window: win('Billing'), screenshot: 'steps/0001.png' },
    { id: 'n', seq: 2, action: 'note', text: 'Wait for the 100% mark & then carry on',
      textEdited: true },
    { id: 'b', seq: 3, action: 'keyText', text: 'Typed "C:' + B + 'reports' + B + 'q3" into the "Path" field',
      point: { x: 120, y: 120 }, window: win('Billing'), screenshot: 'steps/0002.png' },
    { id: 'h', seq: 4, action: 'section', text: 'Approving it' },
    { id: 'c', seq: 5, action: 'leftClick', text: 'Clicked "Approve" in "Ledger"',
      point: { x: 140, y: 140 }, window: win('Ledger'), screenshot: 'steps/0003.png' },
    { id: 'x', seq: 6, action: 'leftClick', text: 'Clicked something excluded',
      excluded: true, point: { x: 1, y: 1 }, window: win('Ledger'),
      screenshot: 'steps/0004.png' },
  ],
};

const tex = buildLatex(session, {
  title: 'Raising a 50% invoice',
  imageDir: 'invoice-images',
  imageRef: (s) => (s.screenshot ? `invoice-images/${path.basename(s.screenshot)}` : null),
});

console.log('escaping every character TeX reserves:');
check('a backslash cannot start a command',
      escape(B) === B + 'textbackslash{}', escape(B));
check('braces are escaped', escape('{x}') === B + '{x' + B + '}');
check('a dollar cannot open maths', escape('$5') === B + '$5');
check('an ampersand cannot end a table cell', escape('a & b') === 'a ' + B + '& b');
check('a hash cannot be a macro parameter', escape('#1') === B + '#1');
check('an underscore cannot subscript', escape('file_name') === 'file' + B + '_name');
check('a percent cannot comment out the rest of the line',
      escape('50% done') === '50' + B + '% done');
check('a tilde cannot become a hard space',
      escape('~/tmp') === B + 'textasciitilde{}/tmp');
check('a caret cannot superscript', escape('2^8') === '2' + B + 'textasciicircum{}8');

console.log('\nand three that are legal but print as the wrong glyph:');
check('< becomes textless', escape('<Enter>').startsWith(B + 'textless{}'));
check('> becomes textgreater', escape('<Enter>').endsWith(B + 'textgreater{}'));
check('a pipe becomes textbar', escape('a|b') === 'a' + B + 'textbar{}b');

console.log('\nescaping happens once, not twice:');
// The replacement for a backslash contains braces. Escaping in two passes would
// turn those into \{\} and print "\textbackslash{}" instead of a backslash.
check('the braces inside a replacement are left alone',
      escape(B) === B + 'textbackslash{}' && !escape(B).includes(B + '{'),
      escape(B));
check('a backslash next to a brace comes out as both',
      escape(B + '{') === B + 'textbackslash{}' + B + '{');

console.log('\ntext off somebody\'s screen cannot become a command:');
// A window title is whatever was on screen. \input pulls another file into the
// document; on a shared Overleaf project that is somebody else's file.
const nasty = buildLatex({
  dir: 'x',
  steps: [{ id: 'z', action: 'leftClick', text: B + 'input{/etc/passwd}',
            point: { x: 1, y: 1 }, window: win(B + 'write18{rm -rf}') }],
}, { title: 'Report ' + B + 'newpage' });
check('an input in a step description is inert',
      !nasty.includes(B + 'input{'), 'a live \\input reached the document');
check('a command in the title is inert',
      !nasty.includes(B + 'newpage'), 'a live \\newpage reached the document');
check('what it prints instead is the literal text',
      nasty.includes(B + 'textbackslash{}input'));

console.log('\nquotes open and close:');
check('the first is an opening pair', tex.includes('``Save'));
check('and the second a closing pair', tex.includes("Save''"));
check('and no straight quote is left in the body',
      !tex.split('\n').filter((l) => !l.startsWith('%')).join('\n').includes('"'),
      'a straight quote would print as a closing quote');

// The header comments name \begin{document} and graphicx on purpose - they are
// the two things the reader has to know. So these look at the BODY: a comment
// mentioning a command and the document issuing one are not the same claim.
const body = tex.split('\n').filter((l) => !l.startsWith('%')).join('\n');

console.log('\nit is a fragment, not a document:');
check('no documentclass', !body.includes(B + 'documentclass'));
check('no begin document', !body.includes(B + 'begin{document}'));
check('no packages, which a fragment cannot load anyway',
      !body.includes(B + 'usepackage{'));
check('it starts at subsection', tex.includes(B + 'subsection{Raising a 50' + B + '% invoice}'));
check('with a label somebody can reference', tex.includes(B + 'label{sec:raising-a-50-invoice}'));
check('and says in a comment what it assumes',
      tex.includes('% Assumes ' + B + 'usepackage{graphicx}'));
check('and where the pictures went', tex.includes('invoice-images'));

// Watched going into Overleaf for the first time: both files uploaded, the
// folder name right, graphicx already in the preamble - and nothing appeared,
// because no line in the document included the fragment. It cannot include
// itself; the least it can do is say how.
{
  const one = { steps: [{ id: 'x', action: 'leftClick', text: 'Clicked Save' }] };
  const named = buildLatex(one, { title: 'Halifax survey', imageDir: 'halifax-images',
                                  inputName: 'halifax' });
  check('the header gives the line that includes it',
        named.includes('% To include it without pasting: ' + B + 'input{halifax}'));

  const spaced = buildLatex(one, { title: 'Halifax survey', inputName: 'Halifax survey' });
  check('with a name that has a space quoted, which TeX would otherwise refuse',
        spaced.includes(B + 'input{"Halifax survey"}'));

  const unnamed = buildLatex(one, { title: 'Halifax survey' });
  check('and says nothing at all when the file has no name yet',
        !unnamed.includes('To include it'));
}

console.log('\nthe procedure itself:');
check('the steps are an enumerate', tex.includes(B + 'begin{enumerate}'));
check('written as instructions', tex.includes(B + 'item Click the ``Save'));
check('a heading becomes a subsubsection',
      tex.includes(B + 'subsubsection{Approving it}'));
check('a note is set apart rather than numbered as a step',
      tex.includes(B + 'begin{quote}') && tex.includes('Wait for the 100' + B + '% mark'));
check('an excluded step is not in the document',
      !tex.includes('something excluded'));

// A heading closes the list, so the one after it starts a new enumerate. Without
// the counter the steps would restart at 1 halfway down the procedure.
console.log('\nand its numbering survives being interrupted:');
check('the list is reopened after a heading',
      (tex.match(/begin\{enumerate\}/g) || []).length === 3,
      `${(tex.match(/begin\{enumerate\}/g) || []).length} lists`);
check('carrying on from where it left off',
      tex.includes(B + 'setcounter{enumi}{1}') && tex.includes(B + 'setcounter{enumi}{2}'),
      tex.match(/setcounter\{enumi\}\{\d\}/g));
check('so the last step is numbered 3, not 1',
      tex.includes('step 3}') && !tex.includes('step 1}\n    \\label{fig:raising-a-50-invoice-3'));

console.log('\nthe screenshots:');
check('each step carries its own figure',
      (tex.match(/includegraphics/g) || []).length === 3);
check('sized against the line, not in centimetres',
      tex.includes('[width=0.85' + B + 'linewidth]'));
check('with a caption that says which procedure and which step',
      tex.includes(B + 'caption{Raising a 50' + B + '% invoice, step 1}'));
// The instruction is already the item directly above the figure. Printing it
// again in the caption reads as a fault in the document.
check('and does not repeat the instruction under it',
      !tex.includes(B + 'caption{Step 1: Click'));
check('and a label of its own', tex.includes(B + 'label{fig:raising-a-50-invoice-1}'));
check('paths use forward slashes, which TeX needs on any platform',
      !tex.includes('includegraphics[width=0.85' + B + 'linewidth]{invoice-images' + B));
check('a step with no screenshot gets no figure',
      buildLatex({ dir: 'x', steps: [{ id: 'q', action: 'leftClick', text: 'Clicked',
                                       point: { x: 1, y: 1 }, window: win('W') }] },
                 { title: 'No pictures' }).includes(B + 'includegraphics') === false);

console.log('\nevery environment that is opened is closed:');
{
  // Not a compiler, but an unbalanced environment is the one structural error
  // that turns the whole paste into a build failure rather than a bad-looking
  // page, and it is exactly what opening and closing the list by hand risks.
  const stack = [];
  let ok = true;
  let why = '';
  for (const line of tex.split('\n')) {
    if (line.startsWith('%')) continue;
    const b = line.match(/\\begin\{([a-z]+)\}/);
    const e = line.match(/\\end\{([a-z]+)\}/);
    if (b) stack.push(b[1]);
    if (e) {
      const last = stack.pop();
      if (last !== e[1]) { ok = false; why = `end{${e[1]}} closed begin{${last}}`; }
    }
  }
  if (stack.length) { ok = false; why = `left open: ${stack.join(', ')}`; }
  check('the environments balance', ok, why);
}

console.log('\nand the awkward inputs:');
check('an empty recording still produces a pasteable subsection',
      buildLatex({ dir: 'x', steps: [] }, { title: 'Nothing yet' })
        .includes(B + 'subsection{Nothing yet}'));
check('a title of nothing but punctuation still gets a usable label',
      buildLatex({ dir: 'x', steps: [] }, { title: '???' }).includes(B + 'label{sec:steps}'));
check('a slug never carries a character TeX has to interpret',
      slugify('Report #4: 50% & rising') === 'report-4-50-rising');
check('the file ends with exactly one newline',
      tex.endsWith('\n') && !tex.endsWith('\n\n'));
check('and has no run of blank lines that would start a new paragraph twice',
      !tex.includes('\n\n\n'));

console.log('\nthe pictures it names are the pictures on disk:');
{
  // The seam this export is most likely to fail at, and the failure is silent.
  // A screenshot re-encoded on the way out is a .jpg holding a .png name, and a
  // fragment that referred to the original extension would compile with every
  // figure missing - a stack of empty boxes in somebody's manual and no error
  // anywhere. So: write them the way the export does, then read the .tex and
  // check that every file it names is really there.
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64');

  const dir = path.join(os.tmpdir(), 'bsr-latex-test-' + Date.now());
  fs.mkdirSync(path.join(dir, 'steps'), { recursive: true });
  const a = path.join(dir, 'steps', '0001.png');
  const b = path.join(dir, 'steps', '0002.png');
  fs.writeFileSync(a, PNG);
  fs.writeFileSync(b, PNG);

  const outDir = path.join(dir, 'out');
  const imageDir = 'guide-images';

  // One of them re-encoded, one not: both routes in the same run, which is what
  // an export of a real recording looks like.
  const images = new Map([[a, { data: Buffer.from('jpeg-bytes'), ext: '.jpg',
                                mime: 'image/jpeg' }]]);
  const names = writeImages({ files: [a, b], images,
                              dir: path.join(outDir, imageDir) });

  const shots = {
    dir,
    steps: [
      { id: '1', action: 'leftClick', text: 'Clicked "One"', point: { x: 1, y: 1 },
        window: win('W'), screenshot: 'steps/0001.png' },
      { id: '2', action: 'leftClick', text: 'Clicked "Two"', point: { x: 1, y: 1 },
        window: win('W'), screenshot: 'steps/0002.png' },
    ],
  };

  const doc = buildLatex(shots, {
    title: 'Guide',
    imageDir,
    imageRef: (step) => {
      const abs = path.join(dir, step.screenshot);
      return names.has(abs) ? `${imageDir}/${names.get(abs)}` : null;
    },
  });

  check('a re-encoded screenshot is named by what it now IS',
        names.get(a) === '0001.jpg', names.get(a));
  check('and an untouched one keeps the name it had',
        names.get(b) === '0002.png', names.get(b));
  check('the bytes written are the re-encoded ones, not the original',
        fs.readFileSync(path.join(outDir, imageDir, '0001.jpg')).toString() === 'jpeg-bytes');

  const referenced = [...doc.matchAll(/includegraphics\[[^\]]*\]\{([^}]+)\}/g)]
    .map((m) => m[1]);
  check('every figure in the fragment names a file', referenced.length === 2,
        referenced.join(', '));
  const missing = referenced.filter(
    (ref) => !fs.existsSync(path.join(outDir, ...ref.split('/'))));
  check('and every one of them exists beside it', missing.length === 0,
        `missing: ${missing.join(', ')}`);

  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
