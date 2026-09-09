#!/usr/bin/env node
/**
 * Puts the build number in the installer's file name.
 *
 * Run after packaging. Until it existed, every build of a version wrote the
 * same file - `StepsRecorder-Setup-0.1.2.exe` - and reported the same version
 * number, so two installers four features apart were distinguishable only by
 * their timestamps. That is not a theoretical tidiness problem: a build was
 * tested, three more were made, and the app was still reporting the first one
 * because nobody could tell there was anything new to install.
 *
 * The version number is deliberately NOT touched. Versions are cut when
 * something is released; builds happen while it is still being tried out, and
 * needing to cut a release in order to tell two test builds apart is exactly
 * backwards.
 *
 * Nothing is deleted. Old installers stay where they are - one of them may
 * already be in somebody's hands, and this script has no way of knowing which.
 * They are about 150MB each, so `dist/` is worth emptying occasionally.
 */
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dist = path.join(root, 'dist');
const info = JSON.parse(
  fs.readFileSync(path.join(root, 'ui', 'build-info.json'), 'utf8'));

const plain = path.join(dist, `StepsRecorder-Setup-${info.version}.exe`);
const named = path.join(dist, `StepsRecorder-Setup-${info.version}-build${info.build}.exe`);

if (!fs.existsSync(plain)) {
  // Not an error: electron-builder may have been given a different target, and
  // failing the build over the name of a file that was produced correctly
  // would be a worse outcome than a plainly named installer.
  console.log(`no ${path.basename(plain)} to rename - left alone`);
  process.exit(0);
}

fs.renameSync(plain, named);

// The block map is what a future differential update would read; it names the
// installer it belongs to, so it travels with it.
const map = `${plain}.blockmap`;
if (fs.existsSync(map)) fs.renameSync(map, `${named}.blockmap`);

console.log(`\n  ${path.basename(named)}`);
console.log(`  build ${info.build} · ${info.commit} · ${info.version}`);
console.log(`  ${named}\n`);
