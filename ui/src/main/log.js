const fs = require('node:fs');
const path = require('node:path');

/**
 * Electron on Windows attaches no console, so console.log from the main process
 * goes nowhere. Anything worth diagnosing after the fact has to reach a file.
 */
let file = null;

function init(userDataDir) {
  file = path.join(userDataDir, 'main.log');
  try {
    // Keep one previous run for comparison; truncate anything older.
    if (fs.existsSync(file) && fs.statSync(file).size > 512 * 1024) {
      fs.renameSync(file, file + '.1');
    }
  } catch { /* logging must never break startup */ }
  write('info', `--- session started ${new Date().toISOString()} ---`);
}

function write(level, message) {
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}\n`;
  try { if (file) fs.appendFileSync(file, line); } catch { /* ignore */ }
}

module.exports = {
  init,
  info: (m) => write('info', m),
  warn: (m) => write('warn', m),
  error: (m) => write('error', m instanceof Error ? `${m.message}\n${m.stack}` : String(m)),
  path: () => file,
};
