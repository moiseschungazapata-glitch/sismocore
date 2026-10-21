import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { api, web, runtimeEnv } from './runtime.mjs';
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
  const webReady = () => ready('http://127.0.0.1:5173/', async r => (await r.text()).includes('/@vite/client'));
  if (!await webReady()) {
    launch(process.execPath, [join(web, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], web);
    let alive = false;
    for (let i = 0; i < 60 && !stopping; i++) {
      if (await webReady()) { alive = true; break; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!alive) throw new Error('No se pudo iniciar la interfaz. Revisa la ventana y el puerto 5173.');
  }
  // Vite owns the backend supervisor, including when an existing Vite process is reused.
  const connected = await ready('http://127.0.0.1:5173/health', async r => (await r.json()).servicio === 'api');
  if (!connected) console.warn('El servicio local se esta recuperando. La interfaz reintentara automaticamente.');
  if (!stopping) {
    console.log('\nSISMOCORE: http://localhost:5173\nAPI: http://127.0.0.1:8000/docs\nMantén esta ventana abierta. Ctrl+C detiene los servicios iniciados aquí.\n');
  }
} catch (error) {
  console.error(`\nNo se pudo iniciar SISMOCORE: ${error.message}`);
  stop(1);
}
