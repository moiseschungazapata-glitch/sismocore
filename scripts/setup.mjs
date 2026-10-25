import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, api, web, venvPython, runtimeEnv, findPython, npm } from './runtime.mjs';

export function setup() {
  if (!existsSync(venvPython)) {
    console.log('Preparando el entorno Python del backend…');
    const result = spawnSync(findPython(), ['-m', 'venv', join(api, '.venv')], { cwd: root, stdio: 'inherit', env: runtimeEnv });
    if (result.status !== 0) throw new Error('No se pudo crear el entorno Python.');
  }
  const check = spawnSync(venvPython, ['-c', 'import sys; from pathlib import Path; from importlib.metadata import version; expected=[line.strip().split("==") for line in Path(sys.argv[1]).read_text().splitlines() if "==" in line and not line.startswith("#")]; assert all(version(name)==wanted for name,wanted in expected)', join(api, 'requirements.txt')], { stdio: 'ignore', env: runtimeEnv });
  if (check.status !== 0) {
    console.log('Instalando dependencias del backend…');
    const pip = spawnSync(venvPython, ['-m', 'pip', 'install', '-r', join(api, 'requirements.txt')], { stdio: 'inherit', env: runtimeEnv });
    if (pip.status !== 0) throw new Error('No se pudieron instalar las dependencias Python. Ejecuta python -m ensurepip en el entorno.');
  }
  if (!existsSync(join(web, 'node_modules/vite/bin/vite.js'))) npm(['ci', '--prefix', web]);
}

if (process.argv[1]?.endsWith('setup.mjs')) {
  try { setup(); console.log('Entorno listo. Ejecuta npm run dev.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
