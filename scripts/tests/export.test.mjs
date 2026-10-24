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

test('Compact report preserves all fields across usable data, summary and technical sheets', async () => {
  const workbook = await crearReporte([event], { ...context, requestedBy:'Responsable', cutoff:'2026-10-22T14:00:00Z', exportId:'export-test' });
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('Eventos sísmicos');
  const summary = reopened.getWorksheet('Resumen');
  const detail = reopened.getWorksheet('Detalle técnico');
  assert.equal(reopened.worksheets.length, 3);
  assert.equal(reopened.views[0].activeTab, 0);
  assert.equal(sheet.getCell('B2').value, event.lugar);
  assert.equal(sheet.getCell('C2').value, 4.2);
  assert.equal(sheet.getCell('D2').value, 35);
  assert.equal(sheet.getCell('E2').value, -17.2615);
  assert.equal(sheet.getCell('F2').value, -72.7858);
  assert.equal(sheet.getCell('G2').value, event.id_externo);
  assert.deepEqual(sheet.getCell('H2').value, { text:'Ver en IGP', hyperlink:'https://ultimosismo.igp.gob.pe/evento/2026-745' });
  assert.equal(sheet.getCell('A2').value.toISOString(), '2026-10-21T21:30:00.000Z');
  assert.equal(detail.getCell('A2').value,event.id_externo);
  assert.equal(detail.getCell('B2').value.toISOString(), '2026-10-22T02:30:00.000Z');
  assert.equal(detail.getCell('C2').value,'Sin dato');
  assert.equal(detail.getCell('D2').value,'Reportado por el IGP');
  assert.equal(detail.getCell('E2').value,event.id);
  assert.equal(summary.getCell('B3').value,'IGP / CENSIS');
  assert.match(summary.getCell('B4').value,/30 días/);
  assert.equal(summary.getCell('B6').value,'Responsable');
  assert.equal(summary.getCell('B8').value,'Camaná');
  assert.equal(summary.getCell('B9').value,'4 a menos de 6');
  assert.equal(summary.getCell('B10').value,'2026-10-15');
  assert.equal(summary.getCell('B11').value,1);
  assert.equal(summary.getCell('B12').value,4.2);
  assert.equal(summary.getCell('B13').value,35);
  assert.equal(summary.getCell('B15').value,'export-test');
  assert.equal(sheet.getCell('C2').numFmt,'0.0');
  assert.equal(sheet.getCell('E2').numFmt,'0.0000');
  for (const table of [sheet, detail]) {
    assert.equal(table.views[0].ySplit,1);
    assert.ok(!table.views[0].xSplit);
    assert.equal(table.pageSetup.printTitlesRow,'1:1');
    assert.deepEqual(table.model.merges,[]);
    assert.equal(table.rowCount,2);
  }
  assert.ok(sheet.getTable('EventosSismicos'));
});

test('Missing magnitude remains blank and formula-like source text remains literal', async () => {
  const workbook = await crearReporte([{ ...event, magnitud:null, lugar:'=1+1' }],context);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('Eventos sísmicos');
  assert.equal(sheet.getCell('C2').value,null);
  assert.equal(sheet.getCell('B2').value,'=1+1');
  assert.equal(sheet.getCell('B2').type,ExcelJS.ValueType.String);
  assert.equal(reopened.getWorksheet('Resumen').getCell('B12').value,'Sin dato');
});

test('Long source links do not expand rows or require a wide URL column', async () => {
  const url = event.url_fuente + '?query=' + 'x'.repeat(1000);
  const workbook = await crearReporte([{ ...event,url_fuente:url }],context);
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer());
  const sheet = reopened.getWorksheet('Eventos sísmicos');
  assert.equal(sheet.getCell('H2').hyperlink,'https://ultimosismo.igp.gob.pe/evento/2026-745');
  assert.equal(reopened.getWorksheet('Detalle técnico').getCell('F2').hyperlink,url);
  assert.ok(sheet.getRow(2).height <= 30);
  assert.ok(sheet.columns.reduce((sum,column) => sum + column.width,0) <= 160);
  assert.equal(sheet.columnCount,8);
});
