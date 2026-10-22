import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { root } from './runtime.mjs';

const email = process.env.TEST_LOGIN_EMAIL;
let password = process.env.TEST_LOGIN_PASSWORD;
delete process.env.TEST_LOGIN_EMAIL;
delete process.env.TEST_LOGIN_PASSWORD;
if (!email || !password) throw new Error('Faltan las credenciales interactivas de prueba.');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const origin = 'http://localhost:5173';
const folder = join(root, '.runtime/login');
const errors = [];
const issues = [];
const checks = [];
let audits = 0;
async function axe(page, label) {
  if (!process.env.AXE_SCRIPT) return;
  await page.addScriptTag({ path: process.env.AXE_SCRIPT });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })));
  audits++;
  if (violations.length) issues.push({ page: label, violations });
}
try {
  await mkdir(folder, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  for (const path of ['/health', '/api/v1/eventos/', '/api/v1/auth/me']) assert.equal((await page.request.get(origin + path)).status(), 401);
  checks.push('API protegida antes de iniciar sesión');
  await page.goto(origin + '/eventos?q=Peru', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
  assert.ok(page.url().includes('/index?next='));
  assert.equal(await page.locator('#login-email').inputValue(), '');
  assert.equal(await page.locator('#login-password').inputValue(), '');
  await page.screenshot({ path: join(folder, 'escritorio.png'), fullPage: true });
  await axe(page, 'login escritorio');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Overflow ${width}`);
    if ([390, 768].includes(width)) { await page.screenshot({ path: join(folder, `ancho-${width}.png`), fullPage: true }); await axe(page, `login ${width}`); }
  }
  checks.push('formulario vacío y adaptable en cinco tamaños');
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill('incorrect-test-value');
  await page.getByRole('button', { name: 'Mostrar contraseña', exact: true }).click();
  assert.equal(await page.locator('#login-password').getAttribute('type'), 'text');
  await page.getByRole('button', { name: 'Ocultar contraseña', exact: true }).click();
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Correo o contraseña incorrectos' }).waitFor();
  assert.equal((await page.request.get(origin + '/api/v1/eventos/')).status(), 401);
  await axe(page, 'error de credenciales');
  checks.push('contraseña visible opcional y error real de Supabase');
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('heading', { name: 'Eventos sísmicos', exact: true }).waitFor({ timeout: 40000 });
  await page.getByText('API y Supabase conectados', { exact: true }).waitFor({ timeout: 40000 });
  assert.ok(page.url().includes('/eventos?q=Peru'));
  const me = await (await page.request.get(origin + '/api/v1/auth/me')).json();
  assert.equal(me.user.email, email);
  assert.equal(me.user.rol, 'administrador');
  assert.equal((await page.request.get(origin + '/api/v1/eventos/')).status(), 200);
  assert.ok((await context.cookies()).filter(c => c.name.startsWith('sismocore_')).every(c => c.httpOnly && c.sameSite === 'Lax'));
  assert.equal(await page.evaluate(() => document.cookie.includes('sismocore_access') || document.cookie.includes('sismocore_refresh')), false);
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }));
  assert.equal(storage.includes(password), false);
  assert.equal(storage.includes('access_token'), false);
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Eventos sísmicos', exact: true }).waitFor();
  await page.screenshot({ path: join(folder, 'sesion-activa.png'), fullPage: true });
  checks.push('acceso real, perfil administrador, redirección y sesión tras recarga');
  checks.push('sesión HttpOnly sin contraseña ni tokens en almacenamiento de JavaScript');

  const second = await context.newPage();
  await second.goto(origin, { waitUntil: 'networkidle' });
  await second.getByRole('heading', { name: 'Dashboard sísmico', exact: true }).waitFor();
  const savedCatalog = await (await page.request.get(origin + '/api/v1/eventos/')).json();
  let releaseCatalog;
  const heldCatalog = new Promise(resolve => { releaseCatalog = resolve; });
  await page.route('**/api/v1/eventos/', route => releaseCatalog(route));
  await page.getByRole('button', { name: 'Actualizar datos', exact: true }).click();
  const lateCatalog = await heldCatalog;
  await page.getByRole('button', { name: 'Cerrar sesión', exact: true }).filter({ visible: true }).click();
  await page.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
  await second.getByRole('heading', { name: 'Iniciar sesión', exact: true }).waitFor();
  const completedCatalog = page.waitForResponse(response => response.url().endsWith('/api/v1/eventos/') && response.status() === 200);
  await lateCatalog.fulfill({ json: savedCatalog });
  await completedCatalog;
  await page.waitForTimeout(150);
  await page.unroute('**/api/v1/eventos/');
  assert.equal((await page.request.get(origin + '/api/v1/eventos/')).status(), 401);
  assert.equal(await page.evaluate(() => sessionStorage.getItem('sismocore.catalogo.v1')), null);
  await page.goBack({ waitUntil: 'networkidle' }).catch(() => null);
  assert.equal(await page.locator('.main-content').count(), 0);
  checks.push('cierre real, limpieza incluso con respuestas tardías y salida en otras pestañas');

  await page.goto(origin + '/index/recuperar', { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Recuperar contraseña', exact: true }).waitFor();
  await axe(page, 'recuperación');
  // Simulated response: do not send an unsolicited recovery email during tests.
  await page.route('**/api/v1/auth/recover', route => route.fulfill({ json: { message: 'Si el correo tiene una cuenta, recibirás un enlace para restablecer la contraseña.' } }));
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Enviar enlace', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Si el correo' }).waitFor();
  await page.unroute('**/api/v1/auth/recover');
  await page.goto(origin + '/index/restablecer', { waitUntil: 'networkidle' });
  await page.getByRole('alert').filter({ hasText: 'Este enlace no es válido' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Guardar contraseña', exact: true }).isDisabled(), true);
  await axe(page, 'enlace de recuperación inválido');
  checks.push('recuperación simulada sin enviar correos y enlace inválido bloqueado');

  await page.goto(origin + '/index', { waitUntil: 'networkidle' });
  await page.getByLabel('Correo electrónico', { exact: true }).fill(email);
  await page.getByLabel('Contraseña', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await page.getByRole('heading', { name: 'Dashboard sísmico', exact: true }).waitFor({ timeout: 40000 });
  password = '';
  process.env.SISMOCORE_TEST_STATE = JSON.stringify(await context.storageState());
  if (errors.length || issues.length) throw new Error(JSON.stringify({ javascript: errors, accesibilidad: issues }, null, 2));
  console.log(JSON.stringify({ login: 'Supabase real', comprobaciones: checks, auditorias_accesibilidad: audits, incidencias_accesibilidad: 0, errores_javascript: errors.length }));
} finally { password = ''; await browser.close(); }

await import('./smoke.mjs');
await import('./phase1-smoke.mjs');
await import('./recovery-smoke.mjs');
delete process.env.SISMOCORE_TEST_STATE;
