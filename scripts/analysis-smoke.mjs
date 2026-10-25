import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel:'chrome',headless:true });
const cutoff = '2026-10-24T01:00:00Z';
const events = Array.from({ length:57 },(_,i) => ({ id:`event-${i}`,id_externo:`2026-${i + 1}`,magnitud:i < 40 ? 3.4 : 4.2,tipo_magnitud:null,lugar:`Perú ${i}`,profundidad:35,latitud:-12,longitud:-77,ocurrido_en:new Date(Date.parse(cutoff) - (i % 27) * 86400000).toISOString(),url_fuente:'https://ide.igp.gob.pe/',estado_revision:'reportado_igp' }));
const errors = [], issues = [];
try {
  const page = await browser.newPage({ viewport:{ width:1440,height:1050 } });
  page.on('pageerror',error => errors.push(error.message));
  await page.route('**/api/v1/auth/me',route => route.fulfill({ json:{ user:{ id:'analyst',nombre_completo:'Prueba',email:'test@example.org',rol:'lectura',estado:'activo',permisos:['catalogo.leer'] } } }));
  await page.route('**/health',route => route.fulfill({ json:{ estado:'saludable',base_datos:'conectada',configurada:true } }));
  await page.route('**/api/v1/eventos',route => route.fulfill({ json:{ eventos:events,total:events.length,consultado_en:cutoff,ultima_sincronizacion:cutoff,periodo_dias:30,codigo_fuente:'igp',fuente:'IGP',frecuencia_segundos:600,ultima_ejecucion:null } }));
  await page.goto((process.env.SMOKE_URL||'http://localhost:5173')+'/analisis');
  await page.getByRole('heading',{ name:'Actividad diaria',exact:true }).waitFor();
  assert.equal(await page.locator('.daily-bar').count(),31);
  assert.deepEqual(await page.locator('.distribution-label strong').evaluateAll(nodes => nodes.map(node => Number(node.firstChild.textContent))),[40,17,0]);
  assert.ok((await page.locator('.analysis-grid').first().boundingBox()).height < 550);
  await page.getByText('Consultar datos diarios',{ exact:true }).click();
  const totals = await page.locator('.daily-data').first().locator('tbody tr').evaluateAll(rows => rows.map(row => Number(row.lastElementChild.textContent)));
  assert.equal(totals.length,31);
  assert.equal(totals.reduce((sum,value) => sum + value,0),57);
  assert.ok(totals.includes(0));
  assert.ok((await page.locator('.daily-table-scroll').first().boundingBox()).height <= 262);
  await page.getByText('Consultar datos diarios',{ exact:true }).click();
  await mkdir('.runtime/analysis',{ recursive:true });
  for (const width of [320,390,768,1024,1440]) {
    await page.setViewportSize({ width,height:1050 });
    await page.waitForTimeout(120);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`Overflow ${width}`);
    if ([390,1440].includes(width)) {
      await page.screenshot({ path:`.runtime/analysis/analisis-${width}.png`,fullPage:true });
      if (process.env.AXE_SCRIPT) {
        await page.addScriptTag({ path:process.env.AXE_SCRIPT });
        const result = await page.evaluate(async () => (await window.axe.run(document,{ runOnly:{ type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] } })).violations.map(v => ({ id:v.id,nodes:v.nodes.map(n => ({ target:n.target,summary:n.failureSummary })) })));
        if (result.length) issues.push({ width,result });
      }
    }
  }
  await page.goto((process.env.SMOKE_URL||'http://localhost:5173')+'/analisis?q=__sin_resultados__');
  await page.getByRole('heading',{ name:'Sin muestra para analizar',exact:true }).waitFor();
  assert.equal(await page.locator('.daily-bar').count(),0);
  await page.getByRole('button',{ name:'Restablecer filtros',exact:true }).click();
  await page.getByRole('heading',{ name:'Actividad diaria',exact:true }).waitFor();
  assert.equal(await page.locator('.daily-bar').count(),31);
  assert.deepEqual(errors,[]);
  assert.deepEqual(issues,[]);
  console.log('Análisis: gráfico compacto, 57 registros conservados, días sin eventos, tabla desplegable, filtros, cinco tamaños y accesibilidad correctos.');
} finally { await browser.close(); }
