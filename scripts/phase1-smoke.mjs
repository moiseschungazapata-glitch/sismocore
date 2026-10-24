// Phase 1: routing, visual states, responsive navigation and keyboard behavior.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { root } from './runtime.mjs';
import { testAuthState } from './test-auth-state.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
const issues = [];
let audits = 0;
const checked = [];
const folder = join(root, '.runtime/phase1');
const origin = 'http://localhost:5173';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function axe(page, label) {
  if (!process.env.AXE_SCRIPT) return;
  await page.addScriptTag({ path: process.env.AXE_SCRIPT });
  const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations.map(v => ({ id: v.id, impact: v.impact, description: v.description, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) })));
  audits++;
  if (violations.length) issues.push({ page: label, violations });
}

async function newPage(width = 1440) {
  const page = await browser.newPage({ viewport: { width, height: 960 }, storageState: testAuthState() });
  page.on('pageerror', error => errors.push({ message: error.message, stack: error.stack, url: page.url() }));
  return page;
}

try {
  await mkdir(folder, { recursive: true });
  const page = await newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.getByText('API y Supabase conectados', { exact: true }).waitFor();
  const data = await (await page.request.get(`${origin}/api/v1/eventos/`)).json();
  assert.ok(data.eventos.length);
  await page.screenshot({ path: join(folder, 'dashboard.png'), fullPage: true });
  await axe(page, 'dashboard');
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('.skip-link').evaluate(el => el === document.activeElement), true);
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('main').evaluate(el => el === document.activeElement), true);
  checked.push('salto al contenido por teclado');

  await page.getByRole('link', { name: 'Eventos sísmicos', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/eventos');
  await page.getByLabel('Buscar ubicación o ID').fill(data.eventos[0].id_externo);
  assert.equal(new URL(page.url()).searchParams.get('q'), data.eventos[0].id_externo);
  await page.getByRole('link', { name: 'Mapa sísmico', exact: true }).click();
  assert.equal(new URL(page.url()).pathname, '/mapa');
  await page.goBack();
  assert.equal(new URL(page.url()).pathname, '/eventos');
  assert.equal(await page.getByLabel('Buscar ubicación o ID').inputValue(), data.eventos[0].id_externo);
  await page.goForward();
  assert.equal(new URL(page.url()).pathname, '/mapa');
  await page.reload({ waitUntil: 'networkidle' });
  assert.equal(await page.getByLabel('Buscar ubicación o ID').inputValue(), data.eventos[0].id_externo);
  assert.equal(await page.locator('.leaflet-interactive').count(), 1);
  checked.push('URLs directas, filtros, recarga, atrás y adelante');
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
  await page.getByRole('link', { name: 'Eventos sísmicos', exact: true }).click();
  await page.getByRole('button', { name: `Ver detalle de ${data.eventos[0].id_externo}`, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByRole('heading', { name: data.eventos[0].lugar, exact: true }).count(), 1);
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press('Tab');
    assert.equal(await dialog.evaluate(el => el.contains(document.activeElement)), true);
  }
  await page.screenshot({ path: join(folder, 'detalle.png'), fullPage: true });
  await axe(page, 'detalle');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.getByRole('button', { name: `Ver detalle de ${data.eventos[0].id_externo}`, exact: true }).evaluate(el => el === document.activeElement), true);
  checked.push('detalle, foco contenido y Escape');

  await page.getByLabel('Buscar ubicación o ID').fill('__sin_coincidencias__');
  await page.getByRole('heading', { name: 'No hay eventos para este filtro', exact: true }).waitFor();
  await page.screenshot({ path: join(folder, 'sin-resultados.png'), fullPage: true });
  await axe(page, 'sin resultados');
  await page.getByRole('button', { name: 'Restablecer filtros', exact: true }).click();
  assert.equal(await page.locator('tbody tr').count(), Math.min(data.total, 20));
  checked.push('estado vacío y restablecimiento de filtros');

  for (const [name, path] of [['Análisis', '/analisis'], ['Fuentes de datos', '/fuentes'], ['Reportes', '/reportes'], ['Modelos de IA', '/modelos'], ['Alertas', '/alertas'], ['Usuarios y roles', '/usuarios'], ['Auditoría', '/auditoria']]) {
    await page.getByRole('link', { name, exact: true }).click();
    assert.equal(new URL(page.url()).pathname, path);
    assert.equal(await page.locator('main h1').count(), 1);
    await axe(page, name);
    if (['Análisis', 'Fuentes de datos', 'Reportes'].includes(name)) await page.screenshot({ path: join(folder, `${path.slice(1)}.png`), fullPage: true });
  }
  checked.push('navegación por todos los módulos');
  await page.goto(`${origin}/direccion-inexistente`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Página no encontrada', exact: true }).waitFor();
  await page.getByRole('link', { name: 'Ir al dashboard', exact: true }).last().click();
  assert.equal(new URL(page.url()).pathname, '/');
  checked.push('ruta desconocida con salida útil');

  const mobile = await newPage(390);
  await mobile.goto(`${origin}/eventos`, { waitUntil: 'networkidle' });
  await mobile.getByRole('status', { name: 'API y Supabase conectados', exact: true }).waitFor();
  assert.equal(await mobile.locator('.event-cards .event-card').count(), Math.min(20, data.total));
  assert.equal(await mobile.locator('.table-scroll').isVisible(), false);
  await mobile.screenshot({ path: join(folder, 'movil-eventos.png'), fullPage: true });
  await axe(mobile, 'móvil eventos');
  const menuButton = mobile.getByRole('button', { name: 'Abrir menú de navegación', exact: true });
  await menuButton.click();
  const menu = mobile.getByRole('dialog', { name: 'Navegación', exact: true });
  await menu.waitFor();
  for (let i = 0; i < 18; i++) {
    await mobile.keyboard.press('Tab');
    assert.equal(await menu.evaluate(el => el.contains(document.activeElement)), true);
  }
  await mobile.screenshot({ path: join(folder, 'movil-menu.png'), fullPage: true });
  await axe(mobile, 'menú móvil');
  await mobile.keyboard.press('Escape');
  assert.equal(await menuButton.evaluate(el => el === document.activeElement), true);
  await menuButton.click();
  await mobile.getByRole('link', { name: 'Fuentes de datos', exact: true }).click();
  assert.equal(await mobile.getByRole('dialog').count(), 0);
  assert.equal(new URL(mobile.url()).pathname, '/fuentes');
  checked.push('tarjetas móviles, menú, teclado y cierre al navegar');
  for (const width of [320, 390, 768, 1024, 1440]) {
    await mobile.setViewportSize({ width, height: 900 });
    await mobile.goto(`${origin}/`, { waitUntil: 'networkidle' });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Desbordamiento a ${width}px`);
    await mobile.screenshot({ path: join(folder, `ancho-${width}.png`), fullPage: true });
  }
  checked.push('sin desbordamiento horizontal en cinco tamaños');

  const loading = await newPage();
  await loading.route('**/api/v1/eventos', async route => { await delay(1700); await route.fulfill({ json: data }); });
  await loading.goto(origin, { waitUntil: 'domcontentloaded' });
  await loading.getByRole('status', { name: 'Consultando el catálogo', exact: true }).waitFor();
  await loading.getByRole('heading', { name: 'Eventos más recientes', exact: true }).waitFor();
  checked.push('carga inicial con skeleton');

  const failed = await newPage();
  const unavailable = route => route.fulfill({ status: 503, json: { detail: 'Servicio no disponible para prueba.' } });
  await failed.route('**/health', unavailable);
  await failed.route('**/api/v1/eventos', unavailable);
  await failed.goto(origin, { waitUntil: 'networkidle' });
  await failed.getByRole('heading', { name: 'Catálogo no disponible', exact: true }).waitFor();
  assert.equal(await failed.locator('.metric-card').count(), 0);
  await failed.screenshot({ path: join(folder, 'error.png'), fullPage: true });
  await axe(failed, 'error sin catálogo');
  checked.push('error inicial sin métricas ficticias');

  const empty = await newPage();
  await empty.route('**/api/v1/eventos', route => route.fulfill({ json: { ...data, total: 0, eventos: [] } }));
  await empty.goto(`${origin}/mapa`, { waitUntil: 'networkidle' });
  await empty.getByRole('heading', { name: 'Sin eventos para este filtro', exact: true }).waitFor();
  assert.equal(await empty.locator('.leaflet-container').count(), 0);
  await axe(empty, 'catálogo vacío');
  checked.push('catálogo vacío explícito');

  if (errors.length) throw new Error(JSON.stringify({ errores_javascript: errors, accesibilidad: issues }, null, 2));
  if (issues.length) throw new Error(JSON.stringify({ accesibilidad: issues }, null, 2));
  console.log(JSON.stringify({ comprobaciones: checked, auditorias_accesibilidad: audits, incidencias_accesibilidad: issues.length, errores_javascript: errors.length }));
} finally { await browser.close(); }
