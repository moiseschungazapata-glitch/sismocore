// Verifies the production report download with simulated data, without credentials.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ExcelJS from '../apps/web/node_modules/exceljs/excel.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const event = {
  id: 'test-id', id_externo: '2026-745', magnitud: 4.2, tipo_magnitud: null,
  lugar: '71 km S de Camaná, Perú', profundidad: 35, latitud: -17.2615,
  longitud: -72.7858, ocurrido_en: new Date().toISOString(), estado_revision: 'reportado_igp',
  url_fuente: 'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0',
};
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { user: { id: 'test-user', email: 'prueba@example.org', nombre_completo: 'Usuario de prueba', rol: 'lectura', estado: 'activo' } } }));
  await page.route('**/health', route => route.fulfill({ json: { estado: 'saludable', base_datos: 'conectada', configurada: true } }));
  await page.route('**/api/v1/eventos', route => route.fulfill({ json: { total: 1, eventos: [event], codigo_fuente: 'igp', fuente: 'IGP / CENSIS', periodo_dias: 30, frecuencia_segundos: 600, consultado_en: new Date().toISOString(), ultima_sincronizacion: new Date().toISOString(), ultima_ejecucion: null } }));
  await page.goto(process.env.REPORT_TEST_URL || 'http://127.0.0.1:4173/reportes');
  const button = page.getByRole('button', { name: 'Descargar reporte', exact: true });
  await button.waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('CSV'));
  const pending = page.waitForEvent('download');
  await button.click();
  const download = await pending;
  assert.ok(download.suggestedFilename().endsWith('.xlsx'));
  await mkdir('.runtime', { recursive: true });
  await download.saveAs('.runtime/reporte-prueba.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('.runtime/reporte-prueba.xlsx');
  const sheet = workbook.getWorksheet('Eventos sísmicos');
  assert.equal(sheet.getCell('B10').value, event.lugar);
  assert.equal(sheet.getCell('C10').value, 4.2);
  await page.getByRole('status').filter({ hasText: 'Reporte preparado' }).waitFor();
  await page.screenshot({ path: '.runtime/reporte-pantalla.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Descarga en navegador: archivo Excel válido, columnas separadas y pantalla sin CSV.');
} finally {
  await browser.close();
}
