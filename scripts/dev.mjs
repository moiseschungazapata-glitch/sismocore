import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { api, web, venvPython, runtimeEnv } from './runtime.mjs';
import { setup } from './setup.mjs';

const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

async function ready(url, predicate) {
  try { const response = await fetch(url, { signal: AbortSignal.timeout(2000) }); return response.ok && await predicate(response); }
  catch { return false; }
}
function launch(command, args, cwd) {
  const child = spawn(command, args, { cwd, env: runtimeEnv, stdio: 'inherit', windowsHide: true });
  children.push(child);
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) { console.error(`Un servicio se detuvo (código ${code}).`); stop(code || 1); } });
  return child;
}

try {
  setup();
  if (!existsSync(join(api, '.env'))) throw new Error('Falta services/api/.env. Configura SUPABASE_URL y SUPABASE_SECRET_KEY a partir de .env.example.');
  const apiReady = () => ready('http://127.0.0.1:8000/health', async r => (await r.json()).servicio === 'api');
  if (!await apiReady()) {
    launch(venvPython, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', '8000', '--no-access-log'], api);
    let alive = false;
    for (let i = 0; i < 40 && !stopping; i++) {
      if (await apiReady()) { alive = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!alive) throw new Error('No se pudo iniciar FastAPI. Revisa el mensaje anterior y el puerto 8000.');
  }
  if (!stopping && !await ready('http://127.0.0.1:5173/', async r => (await r.text()).includes('/@vite/client'))) {
    launch(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], web);
  }
  if (!stopping) {
    console.log('\nSISMOCORE: http://localhost:5173\nAPI: http://127.0.0.1:8000/docs\nMantén esta ventana abierta. Ctrl+C detiene los servicios iniciados aquí.\n');
  }
} catch (error) {
  console.error(`\nNo se pudo iniciar SISMOCORE: ${error.message}`);
  stop(1);
}
