import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const api = join(root, 'services', 'api');
export const web = join(root, 'apps', 'web');
export const venvPython = join(api, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
export const runtimeEnv = { ...process.env, PATH: `${dirname(process.execPath)}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH || ''}` };

export function npm(args) {
  const candidates = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  const cli = candidates.find(p => p && /npm-cli\.js$/.test(p) && existsSync(p));
  if (!cli) throw new Error('Instala Node.js LTS con npm para preparar las dependencias.');
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, stdio: 'inherit', env: runtimeEnv });
  if (result.error || result.status !== 0) throw new Error('No se pudieron instalar las dependencias web.');
}

export function findPython() {
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [process.env.PYTHON_EXE, 'python', 'python3', 'py',
    join(local, 'Programs/Python/Python314/python.exe'),
    join(local, 'Programs/Python/Python313/python.exe'),
    join(local, 'Programs/Python/Python312/python.exe'),
    process.env.USERPROFILE && join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-c', 'import sys; assert sys.version_info >= (3, 11)'], { stdio: 'ignore', timeout: 6000, env: runtimeEnv });
    if (result.status === 0) return candidate;
  }
  throw new Error('Se necesita Python 3.11 o posterior. Instálalo y vuelve a abrir esta ventana, o define PYTHON_EXE.');
}
