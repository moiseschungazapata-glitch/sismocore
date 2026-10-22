import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from '../../apps/web/node_modules/exceljs/excel.js';
import { crearReporte } from '../../apps/web/src/lib/export.ts';

const event = {
  id: 'registro-prueba', id_externo: '2026-745', ocurrido_en: '2026-10-22T02:30:00Z',
  magnitud: 4.2, tipo_magnitud: null, lugar: '71 km S de Camaná, Perú',
  profundidad: 35, latitud: -17.2615, longitud: -72.7858,
  estado_revision: 'reportado_igp', url_fuente: 'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0',
};
const context = {
  filters: { q: 'Camaná', magnitude: 'medio', since: '2026-10-15' },
  lastSync: '2026-10-22T13:18:00Z', generatedAt: new Date('2026-10-22T14:00:00Z'),
};

test('Excel report preserves separate typed columns, accents, provenance and selected filters', async () => {
  const workbook = await crearReporte([event], context);
  const saved = await workbook.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(saved);
  const sheet = reopened.getWorksheet('Eventos sísmicos');
  assert.equal(reopened.worksheets.length, 1);
  assert.match(sheet.getCell('A2').value, /IGP.*30 días/);
  assert.equal(sheet.getCell('B10').value, event.lugar);
  assert.equal(sheet.getCell('C10').value, 4.2);
  assert.equal(sheet.getCell('F10').value, -17.2615);
  assert.equal(sheet.getCell('G10').value, -72.7858);
  assert.equal(sheet.getCell('I10').value, event.id_externo);
  assert.equal(sheet.getCell('K10').value, event.url_fuente);
  assert.equal(sheet.getCell('L10').value, event.id);
  assert.match(sheet.getCell('A10').value, /21\/10\/26/);
  assert.equal(sheet.getCell('J10').value, '2026-10-22T02:30:00.000Z');
  assert.match(sheet.getCell('A5').value, /Camaná.*4 a menos de 6.*2026-10-15/);
  assert.match(sheet.getCell('A6').value, /Eventos: 1.*4.2.*35.0 km/);
  assert.equal(sheet.getCell('C10').numFmt, '0.0');
  assert.equal(sheet.getCell('F10').numFmt, '0.0000');
  assert.equal(sheet.views[0].ySplit, 9);
  assert.ok(sheet.getTable('EventosSismicos'));
  assert.equal(sheet.rowCount, 10);
});

test('Missing magnitude is blank and formula-like source text remains literal', async () => {
  const workbook = await crearReporte([{ ...event, magnitud: null, lugar: '=1+1' }], context);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('Eventos sísmicos');
  assert.equal(sheet.getCell('C10').value, null);
  assert.equal(sheet.getCell('B10').value, '=1+1');
  assert.equal(sheet.getCell('B10').type, ExcelJS.ValueType.String);
  assert.match(sheet.getCell('A6').value, /Magnitud máxima: Sin dato/);
});
