/**
 * Every Mermaid diagram in the documentation actually parses.
 *
 * The field guide is a deliverable, not a comment: it is what a stranger reads
 * on GitHub to understand the system, and GitHub renders these diagrams itself.
 * A diagram with a syntax error does not degrade - it is replaced by a red
 * "Unable to render rich display" box, and the reader loses the picture and
 * gets a parser trace instead. One shipped that way and nothing here noticed,
 * because nothing here had ever read the documentation.
 *
 * Parsed with the real Mermaid, in a real window, because the failure this
 * exists to catch was a grammar detail no regular expression would have
 * predicted: `&quot;` inside a node label is decoded to a plain quote, which
 * closes the label early and leaves the rest as stray tokens.
 *
 *   npx electron tests/diagrams_test.js
 */
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DOCS = ['README.md', 'CHANGELOG.md', 'docs/FIELD-GUIDE.md',
              'docs/ENGINEERING.md', 'docs/ipc-contract.md'];

let pass = 0, fail = 0;
const check = (n, c, why) => {
  if (c) { pass++; console.log('  PASS ' + n); }
  else { fail++; console.log('  FAIL ' + n + (why ? '\n        ' + why : '')); }
};

/** Every ```mermaid block in a file, with the line it starts on. */
function diagramsIn(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return [];

  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const found = [];
  let open = null;

  lines.forEach((line, i) => {
    if (open === null && /^\s*```mermaid\s*$/.test(line)) { open = i; return; }
    if (open !== null && /^\s*```\s*$/.test(line)) {
      found.push({ file: rel, line: open + 1, text: lines.slice(open + 1, i).join('\n') });
      open = null;
    }
  });
  return found;
}

const watchdog = setTimeout(() => {
  console.log('\nTIMED OUT');
  app.exit(2);
}, 120000);

app.whenReady().then(async () => {
  const all = DOCS.flatMap(diagramsIn);

  const dir = path.join(os.tmpdir(), `bsr-diagrams-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  // Its own package.json: Node resolves by walking up, and an unrelated
  // malformed one in the temp folder has broken a test here before.
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"commonjs"}');

  const mermaid = path.join(ROOT, 'ui', 'node_modules', 'mermaid', 'dist', 'mermaid.esm.mjs');
  if (!fs.existsSync(mermaid)) {
    console.log('mermaid is not installed. From ui/: npm ci');
    app.exit(1);
    return;
  }

  fs.writeFileSync(path.join(dir, 'page.html'),
    '<!doctype html><meta charset="utf-8"><body></body>');

  const win = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false },
  });
  await win.loadFile(path.join(dir, 'page.html'));

  console.log(`parsing every diagram in the documentation (${all.length} found):`);
  check(`there are diagrams to check (${all.length})`, all.length >= 5);

  for (const d of all) {
    const result = await win.webContents.executeJavaScript(`(async () => {
      const m = await import(${JSON.stringify('file:///' + mermaid.replace(/\\/g, '/'))});
      m.default.initialize({ startOnLoad: false });
      try {
        await m.default.parse(${JSON.stringify(d.text)});
        return { ok: true };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err).split('\\n')[0] };
      }
    })()`);

    check(`${d.file}:${d.line}`, result.ok, result.error);
  }

  // The parser above runs whatever Mermaid this repository installed. GitHub
  // renders with its own, older one - and the diagram that prompted all this
  // parsed cleanly here while GitHub replaced it with a red error box. So the
  // known cross-version hazard is checked as a rule in its own right rather
  // than trusted to the local grammar.
  console.log('\nand uses nothing a stricter renderer would refuse:');
  for (const d of all) {
    const labels = [...d.text.matchAll(/\[\s*"([^\]]*)"\s*\]/g)].map((m) => m[1]);
    const risky = labels.filter((l) => /&quot;|&#34;|"/.test(l));
    check(`${d.file}:${d.line} has no quote entities inside a label`,
          risky.length === 0,
          risky.length
            ? `a quote inside a label closes it early on some renderers: ${risky[0].slice(0, 70)}`
            : '');
  }

  fs.rmSync(dir, { recursive: true, force: true });
  clearTimeout(watchdog);
  console.log(`\n${pass} passed, ${fail} failed`);
  app.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); app.exit(1); });
