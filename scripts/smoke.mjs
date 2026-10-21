// Optional browser check: install Playwright separately, or set PLAYWRIGHT_MODULE.
import { mkdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { root } from './runtime.mjs';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  await mkdir(join(root, '.runtime'), { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  await page.getByText('API y Supabase conectados', { exact: true }).waitFor({ timeout: 30000 });
  const response = await page.request.get('http://localhost:5173/api/v1/eventos/');
  if (!response.ok()) throw new Error('El proxy no devuelve el catálogo.');
  const data = await response.json();
  if (data.almacenamiento !== 'Supabase' || !data.total || !data.consultado_en) throw new Error('Catálogo persistente incompleto.');
  await page.screenshot({ path: join(root, '.runtime/dashboard.png'), fullPage: true });
  await page.getByRole('link', { name: 'Eventos sísmicos', exact: true }).click();
  if (await page.locator('tbody tr').count() !== Math.min(20, data.total)) throw new Error('La tabla no coincide con la API.');
  await page.getByLabel('Buscar ubicación o ID').fill(data.eventos[0].id_externo);
  if (await page.locator('tbody tr').count() !== 1) throw new Error('La búsqueda no filtra la tabla.');
  await page.getByRole('link', { name: 'Mapa sísmico', exact: true }).click();
  await page.locator('.leaflet-container').waitFor();
  if (await page.locator('.leaflet-interactive').count() !== 1) throw new Error('El mapa no comparte los filtros.');
  await page.getByRole('button', { name: 'Limpiar filtros', exact: true }).click();
  await page.waitForTimeout(1200);
  if (await page.locator('.leaflet-interactive').count() !== data.total) throw new Error('No se restauraron los puntos del mapa.');
  const tiles = await page.locator('.leaflet-tile-loaded').count();
  await page.screenshot({ path: join(root, '.runtime/mapa.png'), fullPage: true });
  await page.getByRole('link', { name: 'Análisis', exact: true }).click();
  await page.getByRole('heading', { name: 'Distribución por magnitud', exact: true }).waitFor();
  if (await page.locator('.bar-chart').count() !== 2) throw new Error('Faltan las gráficas descriptivas.');
  await page.getByRole('link', { name: 'Fuentes de datos', exact: true }).click();
  await page.getByText('Supabase conectada', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Reportes', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar eventos CSV', exact: true }).click();
  const download = await pending;
  const file = join(root, '.runtime/eventos-prueba.csv');
  await download.saveAs(file);
  const csv = await readFile(file, 'utf8');
  if (!csv.includes(data.eventos[0].id_externo) || !csv.includes('fecha_utc')) throw new Error('CSV incompleto.');
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const markersVisible = await page.locator('.leaflet-container').evaluate(container => {
    const box = container.getBoundingClientRect();
    return [...container.querySelectorAll('.leaflet-interactive')].every(marker => {
      const point = marker.getBoundingClientRect();
      return point.left >= box.left && point.right <= box.right && point.top >= box.top && point.bottom <= box.bottom;
    });
  });
  if (!markersVisible) throw new Error('Los marcadores quedan fuera del mapa al cambiar a móvil.');
  await page.screenshot({ path: join(root, '.runtime/movil.png'), fullPage: true });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(JSON.stringify({ api: 'conectada', supabase: 'conectada', eventos: data.total, tabla: 'correcta', mapa: 'correcto', teselas_cargadas: tiles, filtros_compartidos: 'correctos', analisis: 'correcto', csv: 'correcto', errores_javascript: errors.length }));
} finally {
  await browser.close();
}
