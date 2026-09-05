#!/usr/bin/env node
/**
 * Records which commit a build came from, and when.
 *
 * Run before packaging. Without it a packaged app has no git repository to ask
 * and could only report its version number - which is exactly the thing that
 * does not change between builds.
 */
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'ui', 'build-info.json');

function git(args, fallback) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

const dirty = git(['status', '--porcelain'], '').length > 0;
const commit = git(['rev-parse', '--short', 'HEAD'], 'unknown');

const info = {
  version: JSON.parse(fs.readFileSync(path.join(root, 'ui', 'package.json'), 'utf8')).version,
  // A trailing + means the tree had uncommitted changes: the commit alone does
  // not describe what was built.
  commit: dirty ? `${commit}+` : commit,
  built: new Date().toISOString(),
  source: 'packaged',
};

fs.writeFileSync(out, JSON.stringify(info, null, 2) + '\n');
console.log(`build stamp: ${info.version} ${info.commit} ${info.built}`);
if (dirty) {
  console.log('  note: working tree was not clean when this was built');
}
