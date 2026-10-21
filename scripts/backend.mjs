import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { api, root, runtimeEnv, venvPython } from './runtime.mjs';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Owned by Vite, not by an independent terminal or a temporary test session.
export class BackendSupervisor {
  constructor(options = {}) {
    this.url = options.url || 'http://127.0.0.1:8000/live';
    this.command = options.command || venvPython;
    this.args = options.args || ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000', '--no-access-log'];
    this.cwd = options.cwd || api;
    this.checkFiles = options.checkFiles ?? true;
    this.directory = options.directory || join(root, '.runtime');
    this.intervalMs = options.intervalMs || 5000;
    this.timeoutMs = options.timeoutMs || 20000;
    this.logger = options.logger || console;
    this.child = null;
    this.pending = null;
    this.timer = null;
    this.stopped = false;
    this.lastError = '';
  }

  async healthy() {
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(1200) });
      return response.ok && (await response.json()).servicio === 'api';
    } catch { return false; }
  }

  async ensure() {
    if (this.stopped) return false;
    if (this.pending) return this.pending;
    this.pending = this.ensureOnce().finally(() => { this.pending = null; });
    return this.pending;
  }

  async ensureOnce() {
    if (await this.healthy()) { this.lastError = ''; return true; }
    if (this.stopped) return false;
    if (this.checkFiles && (!existsSync(this.command) || !existsSync(join(this.cwd, '.env')))) {
      this.lastError = 'Falta el entorno Python o la configuración privada. Inicia con Iniciar SISMOCORE.cmd.';
      return false;
    }
    if (!this.child) this.launch();
    const deadline = Date.now() + this.timeoutMs;
    while (!this.stopped && this.child && Date.now() < deadline) {
      await sleep(200);
      if (await this.healthy()) {
        this.lastError = '';
        this.logger.info('[SISMOCORE] API local disponible; recuperación automática activa.');
        return true;
      }
    }
    if (!this.lastError) this.lastError = 'La API no pudo iniciar. Revisa .runtime/api.log y que el puerto 8000 esté libre.';
    return false;
  }

  launch() {
    mkdirSync(this.directory, { recursive: true });
    const output = openSync(join(this.directory, 'api.log'), 'a');
    let child;
    try {
      child = spawn(this.command, this.args, {
        cwd: this.cwd, env: runtimeEnv, stdio: ['ignore', output, output], windowsHide: true,
      });
    } finally { closeSync(output); }
    this.child = child;
    const record = join(this.directory, 'api-process.json');
    if (child.pid) writeFileSync(record, JSON.stringify({ pid: child.pid, startedAt: new Date().toISOString() }));
    const ended = error => {
      if (this.child !== child) return;
      this.child = null;
      try {
        if (JSON.parse(readFileSync(record, 'utf8')).pid === child.pid) unlinkSync(record);
      } catch { /* A prior server may have removed its own record. */ }
      if (!this.stopped) {
        this.lastError = error ? 'No se pudo iniciar Python. Revisa el entorno del servidor.' : 'La API se detuvo; se está recuperando automáticamente.';
        this.logger.warn(`[SISMOCORE] ${this.lastError}`);
      }
    };
    child.once('error', ended);
    child.once('exit', () => ended());
  }

  async start() {
    const ready = await this.ensure();
    if (!this.timer && !this.stopped) {
      this.timer = setInterval(() => {
        void this.ensure().catch(() => { this.lastError = 'No se pudo recuperar la API local.'; });
      }, this.intervalMs);
      this.timer.unref();
    }
    return ready;
  }

  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.child?.kill();
  }
}
