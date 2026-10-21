// Regression: preserve the last successful query and recover a failed local API.
import { readFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { root, venvPython } from './runtime.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 768 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.getByText('API y Supabase conectados', { exact: true }).waitFor({ timeout: 30000 });
  const initial = await (await page.request.get('http://localhost:5173/api/v1/eventos/')).json();
  const initialRows = await page.locator('tbody tr').count();
  if (!initialRows || !initial.total) throw new Error('No hay catálogo disponible para verificar recuperación.');

  // Simulate unavailable responses, then reload: state must survive a full page load.
  const outage = async route => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ detail: 'Interrupción simulada para comprobar la recuperación.' }) });
  await page.route('**/health', outage);
  await page.route('**/api/v1/eventos/', outage);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('Se conserva la última consulta disponible; sus datos pueden estar desactualizados.', { exact: true }).waitFor();
  if (await page.locator('tbody tr').count() !== initialRows) throw new Error('Se perdió la última consulta al recargar sin API.');
  await page.getByText('Reconectando con la API…', { exact: true }).waitFor();
  await page.unroute('**/health', outage);
  await page.unroute('**/api/v1/eventos/', outage);
  // The 5-second retry must recover without clicking a button.
  await page.getByText('API y Supabase conectados', { exact: true }).waitFor({ timeout: 15000 });

  // Terminate only the exact uvicorn process recorded by this application's supervisor.
  const recordPath = join(root, '.runtime/api-process.json');
  const original = JSON.parse(await readFile(recordPath, 'utf8'));
  if (!Number.isInteger(original.pid)) throw new Error('PID inválido.');
  const checkAndStop = `$apiProcess = Get-CimInstance Win32_Process -Filter "ProcessId = ${original.pid}"; if ($apiProcess.ExecutablePath -ne '${venvPython.replace(/'/g, "''")}' -or $apiProcess.CommandLine -notmatch 'uvicorn main:app') { throw 'El proceso no corresponde al backend esperado' }; Stop-Process -Id ${original.pid} -Force`;
  const stopped = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', checkAndStop], { encoding: 'utf8', windowsHide: true });
  if (stopped.status !== 0) throw new Error('No se pudo comprobar y detener el proceso esperado.');
  const limit = Date.now() + 20000;
  let replacement;
  while (Date.now() < limit) {
    await pause(300);
    try {
      const current = JSON.parse(await readFile(recordPath, 'utf8'));
      if (current.pid !== original.pid) { replacement = current.pid; break; }
    } catch { /* The old PID file is removed before its replacement is written. */ }
  }
  if (!replacement) throw new Error('Vite no reinició la API al detenerse.');
  await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
  await page.getByText('API y Supabase conectados', { exact: true }).waitFor({ timeout: 30000 });
  const recovered = await (await page.request.get('http://localhost:5173/api/v1/eventos/')).json();
  if (recovered.total !== initial.total) throw new Error('El catálogo cambió durante la recuperación.');
  await mkdir(join(root, '.runtime'), { recursive: true });
  await page.screenshot({ path: join(root, '.runtime/recuperacion.png'), fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ cache_al_recargar: 'correcta', reintento_automatico: 'correcto', reinicio_real_api: 'correcto', eventos_conservados: recovered.total, errores_javascript: errors.length }));
} finally { await browser.close(); }
