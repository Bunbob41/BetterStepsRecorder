const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

const EXE = 'bettersteps-capture.exe';

/**
 * Owns the C# capture process and the NDJSON framing on its stdio.
 * Emits: 'ready', 'step', 'error', 'log', 'exit'.
 */
class Sidecar extends EventEmitter {
  #proc = null;
  #buffer = '';

  static resolveExe(projectRoot) {
    const candidates = [
      // Packaged: shipped alongside the app as an extra resource.
      path.join(process.resourcesPath || '', 'capture', EXE),
      // Development: whichever build config was produced last.
      path.join(projectRoot, 'capture', 'bin', 'Release', 'net10.0-windows', EXE),
      path.join(projectRoot, 'capture', 'bin', 'Debug', 'net10.0-windows', EXE),
    ];
    return candidates.find((p) => p && fs.existsSync(p)) || null;
  }

  get running() {
    return this.#proc !== null;
  }

  start(exePath) {
    if (this.#proc) return;

    this.#proc = spawn(exePath, [], { stdio: ['pipe', 'pipe', 'pipe'] });
    this.#proc.stdout.setEncoding('utf8');

    this.#proc.stdout.on('data', (chunk) => this.#consume(chunk));

    // stderr is never parsed — it carries .NET crash text, not protocol.
    this.#proc.stderr.setEncoding('utf8');
    this.#proc.stderr.on('data', (text) => {
      this.emit('log', { level: 'warn', message: `[sidecar stderr] ${text.trim()}` });
    });

    this.#proc.on('exit', (code) => {
      this.#proc = null;
      this.#buffer = '';
      this.emit('exit', code);
    });

    this.#proc.on('error', (err) => {
      this.#proc = null;
      this.emit('error', { code: 'SPAWN_FAILED', message: err.message });
    });
  }

  #consume(chunk) {
    this.#buffer += chunk;

    // A single stdout read can split mid-line or carry several lines at once;
    // only complete lines are parseable, so the remainder stays buffered.
    let newline;
    while ((newline = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newline).trim();
      this.#buffer = this.#buffer.slice(newline + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.emit('log', { level: 'warn', message: `unparseable line: ${line.slice(0, 200)}` });
        continue;
      }

      // Unknown types are ignored by contract, so a newer sidecar cannot
      // break an older UI.
      if (typeof msg.type === 'string') this.emit(msg.type, msg);
    }
  }

  send(command) {
    if (!this.#proc) return false;
    this.#proc.stdin.write(JSON.stringify({ v: 1, id: crypto.randomUUID(), ...command }) + '\n');
    return true;
  }

  startSession(sessionDir, ignorePids = [], image = {}) {
    return this.send({ type: 'start', sessionDir, ignorePids, ...image });
  }
  pause()  { return this.send({ type: 'pause' }); }
  resume() { return this.send({ type: 'resume' }); }

  stop() {
    if (!this.#proc) return;
    this.send({ type: 'stop' });
    // Closing stdin is the sidecar's orphan guard: if the stop message is
    // somehow missed, EOF makes it quit rather than linger holding a global hook.
    this.#proc.stdin.end();
  }

  kill() {
    if (this.#proc) this.#proc.kill();
  }
}

module.exports = { Sidecar };
