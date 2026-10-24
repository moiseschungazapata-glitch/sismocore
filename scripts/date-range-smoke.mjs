import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import ExcelJS from '../apps/web/node_modules/exceljs/excel.js';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel:'chrome',headless:true });
const cutoff = '2026-10-24T12:00:00Z';
const events = ['2026-10-21T23:59:59Z','2026-10-22T00:00:00Z','2026-10-23T23:59:59Z','2026-10-24T00:00:00Z'].map((date,index) => ({ id:`event-${index}`,id_externo:`2026-${index + 1}`,magnitud:4,tipo_magnitud:null,lugar:`Perú ${index}`,profundidad:35,latitud:-12,longitud:-77,ocurrido_en:date,url_fuente:'https://ide.igp.gob.pe/',estado_revision:'reportado_igp' }));
const errors = [], issues = [];
try {
  const page = await browser.newPage({ viewport:{ width:1440,height:1000 } });
  page.on('pageerror',error => errors.push(error.message));
  await page.route('**/api/v1/auth/me',route => route.fulfill({ json:{ user:{ id:'analyst',nombre_completo:'Prueba',email:'test@example.org',rol:'analista',estado:'activo',permisos:['catalogo.leer','reportes.exportar'] } } }));
  await page.route('**/health',route => route.fulfill({ json:{ estado:'saludable',base_datos:'conectada',configurada:true } }));
  await page.route('**/api/v1/eventos',route => route.fulfill({ json:{ eventos:events,total:4,consultado_en:cutoff,ultima_sincronizacion:cutoff,periodo_dias:30,codigo_fuente:'igp',fuente:'IGP',frecuencia_segundos:600,ultima_ejecucion:null } }));
  await page.route('**/api/v1/reportes/exportar',route => {
    const body = route.request().postDataJSON();
    assert.equal(body.desde,'2026-10-22'); assert.equal(body.hasta,'2026-10-23');
    return route.fulfill({ json:{ eventos:events.slice(1,3),total:2,consultado_en:cutoff,ultima_sincronizacion:cutoff,periodo_dias:30,solicitante:{ id:'analyst',nombre:'Prueba' },exportacion_id:'test-export',correlacion_id:'test-request' } });
  });
  await page.goto('http://localhost:5173/reportes');
  await page.getByLabel('Desde · fecha UTC',{ exact:true }).fill('2026-10-22');
  await page.getByLabel('Hasta · fecha UTC',{ exact:true }).fill('2026-10-23');
  await page.getByText('2 de 4 eventos',{ exact:true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get('hasta'),'2026-10-23');
  await page.getByRole('link',{ name:'Eventos sísmicos',exact:true }).click();
  assert.equal(await page.locator('tbody tr').count(),2);
  assert.equal(await page.getByLabel('Hasta · fecha UTC',{ exact:true }).inputValue(),'2026-10-23');
  await page.getByRole('link',{ name:'Reportes',exact:true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button',{ name:'Descargar reporte',exact:true }).click();
  await mkdir('.runtime/date-range',{ recursive:true });
  await (await downloaded).saveAs('.runtime/date-range/rango.xlsx');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile('.runtime/date-range/rango.xlsx');
  assert.equal(workbook.getWorksheet('Eventos sísmicos').rowCount,3);
  assert.equal(workbook.getWorksheet('Resumen').getCell('B10').value,'2026-10-22');
  assert.equal(workbook.getWorksheet('Resumen').getCell('B11').value,'2026-10-23');
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width,height:1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`Overflow ${width}`);
    if ([390,1440].includes(width)) {
      await page.screenshot({ path:`.runtime/date-range/filtros-${width}.png`,fullPage:true });
      if (process.env.AXE_SCRIPT) {
        await page.addScriptTag({ path:process.env.AXE_SCRIPT });
        const result = await page.evaluate(async () => (await window.axe.run(document,{ runOnly:{ type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] } })).violations.map(v => ({ id:v.id,nodes:v.nodes.map(n => ({ target:n.target,summary:n.failureSummary })) })));
        if (result.length) issues.push({ width,result });
      }
    }
  }
  await page.getByRole('button',{ name:'Limpiar filtros',exact:true }).click();
  assert.equal(await page.getByLabel('Desde · fecha UTC',{ exact:true }).inputValue(),'');
  assert.equal(await page.getByLabel('Hasta · fecha UTC',{ exact:true }).inputValue(),'');
  await page.goto('http://localhost:5173/reportes?desde=2026-10-23&hasta=2026-10-22');
  await page.getByRole('alert').filter({ hasText:'La fecha Hasta debe ser igual o posterior a Desde.' }).waitFor();
  assert.equal(await page.getByRole('button',{ name:'Descargar reporte',exact:true }).isDisabled(),true);
  assert.deepEqual(errors,[]); assert.deepEqual(issues,[]);
  console.log('Rango inclusivo, navegación compartida, Excel con ambas fechas, limpieza, rango inválido y cinco tamaños verificados.');
} finally { await browser.close(); }
