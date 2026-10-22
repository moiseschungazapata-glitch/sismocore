import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { root } from './runtime.mjs';

const link = process.env.RECOVERY_TEST_LINK;
delete process.env.RECOVERY_TEST_LINK;
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  let updates = 0;
  page.on('request', request => { if (request.url().endsWith('/api/v1/auth/password')) updates++; });
  await page.goto(link, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Nueva contraseña', exact: true }).waitFor();
  const button = page.getByRole('button', { name: 'Guardar contraseña', exact: true });
  await button.waitFor();
  await page.waitForFunction(() => !document.querySelector('.login-submit')?.disabled, { timeout: 30000 });
  assert.equal((await page.request.get('http://localhost:5173/api/v1/auth/me')).status(), 200);
  assert.equal(new URL(page.url()).hash, '');
  assert.equal(await page.evaluate(() => document.cookie.includes('sismocore_access')), false);
  await page.locator('#login-password').fill('not-submitted-test-password');
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill('different-test-password');
  await button.click();
  await page.getByRole('alert').filter({ hasText: 'Las contraseñas no coinciden.' }).waitFor();
  assert.equal(updates, 0);
  await page.locator('#login-password').fill('');
  await page.getByLabel('Confirmar contraseña', { exact: true }).fill('');
  await page.screenshot({ path: join(root, '.runtime/login/recuperacion-validada.png'), fullPage: true });
  assert.equal((await page.request.post('http://localhost:5173/api/v1/auth/logout', { headers: { Origin: 'http://localhost:5173' } })).status(), 204);
  console.log(JSON.stringify({ enlace_recuperacion_supabase: 'validado', retorno_local: 'correcto', tokens_eliminados_de_url: true, sesion_httponly: true, confirmacion_contrasena: 'validada', correos_enviados: 0, contrasena_modificada: false }));
} finally { await browser.close(); }
