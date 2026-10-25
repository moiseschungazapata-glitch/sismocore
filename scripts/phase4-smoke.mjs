import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
import {mkdir} from 'node:fs/promises'
import ExcelJS from '../apps/web/node_modules/exceljs/excel.js'
import {matchesEvent} from '../apps/web/src/lib/filters.ts'
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const base=process.env.SMOKE_URL||'http://127.0.0.1:5179'
const cutoff='2026-10-24T22:00:00Z'
const events=Array.from({length:60},(_,i)=>({id:`11111111-1111-4111-8111-${String(i+1).padStart(12,'0')}`,id_externo:`2026-${749-i}`,lugar:`Evento ${i} ${i%2?'Lima':'Tumbes'}`,region:i%2?'LIMA':'TUMBES',magnitud:i===0?null:3+i%4*.5,profundidad:10+i*3,latitud:i%2?-12-i*.001:-4-i*.001,longitud:i%2?-77-i*.001:-80-i*.001,ocurrido_en:new Date(Date.parse(cutoff)-i*3600000).toISOString(),recibido_en:cutoff,hash_origen:'a'.repeat(64),tipo_magnitud:null,url_fuente:'https://ultimosismo.igp.gob.pe/evento/2026-749',estado_revision:'reportado_igp'}))
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 for(const mobile of [false,true]){
 const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1440,height:1000},isMobile:mobile,hasTouch:mobile})
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.route('**/api/v1/**',async route=>{
 const path=new URL(route.request().url()).pathname
 let json={}
 if(path.endsWith('/auth/me'))json={user:{id:'test',nombre_completo:'Prueba',email:'test@example.invalid',rol:'analista',estado:'activo',permisos:['catalogo.leer','fuentes.leer','reportes.exportar']}}
 else if(path.endsWith('/auth/logout'))json={}
 else if(path.endsWith('/eventos'))json={eventos:events,total:events.length,fuente:'IGP / CENSIS',codigo_fuente:'igp',consultado_en:cutoff,ultima_sincronizacion:cutoff,periodo_dias:30,frecuencia_segundos:300,alertas_activas:2,ultima_ejecucion:{estado:'completada',registros_recibidos:61,registros_rechazados:1,registros_insertados:1,registros_actualizados:0}}
 else if(path.endsWith('/reportes/exportar')){const body=route.request().postDataJSON();const f={q:body.q,magnitude:body.magnitud,since:body.desde||'',until:body.hasta||'',minMagnitude:body.mag_min===null?'':String(body.mag_min),maxMagnitude:body.mag_max===null?'':String(body.mag_max),minDepth:body.prof_min===null?'':String(body.prof_min),maxDepth:body.prof_max===null?'':String(body.prof_max),region:body.region||'',source:body.fuente||'',latitude:body.lat===null?'':String(body.lat),longitude:body.lon===null?'':String(body.lon),radius:body.radio===null?'':String(body.radio),polygon:body.poligono?JSON.stringify(body.poligono):''};const rows=events.filter(e=>matchesEvent(e,f));json={eventos:rows,total:rows.length,consultado_en:cutoff,ultima_sincronizacion:cutoff,periodo_dias:30,solicitante:{id:'test',nombre:'Prueba'},exportacion_id:'prueba'}}
 else throw new Error('API inesperada '+path)
 await route.fulfill({json})
 })
 await page.route('**/health',r=>r.fulfill({json:{estado:'ok',base_datos:'conectada'}}))
 await page.route(/https:\/\/(.*tile.openstreetmap.org|gibs.earthdata.nasa.gov)\/.*/,r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#233d48"/></svg>'}))
 await page.goto(base+'/')
 await page.getByRole('heading',{name:'Estado del monitoreo',exact:true}).waitFor()
 assert.equal(await page.locator('.leaflet-container').count(),0)
 assert.equal(await page.locator('.daily-bar').count(),31)
 await page.goto(base+'/eventos')
 await page.getByLabel('Ordenar eventos').selectOption('magnitud-desc')
 assert.match(await page.locator('.events-table tbody tr').first().textContent(),/4.5/)
 await page.getByText('Filtros avanzados · magnitud, profundidad y zona',{exact:true}).click()
 await page.getByLabel('Magnitud mínima',{exact:true}).fill('4')
 await page.getByLabel('Profundidad máxima (km)',{exact:true}).fill('100')
 await page.getByLabel('Región',{exact:true}).selectOption('LIMA')
 const n=events.filter(e=>e.region==='LIMA'&&e.magnitud>=4&&e.profundidad<=100).length
 await page.getByText(`${n} de 60 eventos`,{exact:true}).waitFor()
 await page.goto(base+'/analisis'+new URL(page.url()).search)
 await page.getByRole('heading',{name:'Magnitud y profundidad',exact:true}).waitFor()
 await page.getByLabel('Agrupación temporal').selectOption('semana')
 await page.getByLabel('Resolución de profundidad').selectOption('25')
 await page.getByLabel('Variable X',{exact:true}).selectOption('magnitud')
 await page.getByLabel('Variable Y',{exact:true}).selectOption('profundidad')
 assert.equal(await page.locator('.scatter-chart circle').count(),n)
 await page.getByText('Consultar observaciones del análisis',{exact:true}).click()
 assert.equal(await page.locator('.daily-data').last().locator('tbody tr').count(),n)
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Exportar muestra a Excel',exact:true}).click()
 await mkdir('.runtime/phase4',{recursive:true});const file=`.runtime/phase4/muestra-${mobile}.xlsx`;await(await download).saveAs(file)
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);assert.equal(book.getWorksheet('Eventos sísmicos').rowCount,n+1)
 assert.ok(book.getWorksheet('Resumen').getColumn(1).values.includes('Región seleccionada'))
 await page.goto(base+'/mapa')
 await page.getByLabel('Agrupar puntos cercanos').waitFor()
 assert.ok(await page.locator('.cluster-label').count()>0)
 await page.getByLabel('Agrupar puntos cercanos').uncheck()
 assert.equal(await page.locator('.cluster-label').count(),0)
 await page.getByRole('button',{name:'Dibujar polígono',exact:true}).click()
 const map=page.locator('.leaflet-container');const box=await map.boundingBox()
 for(const [x,y] of [[.3,.3],[.7,.3],[.7,.7],[.3,.7]])await map.click({position:{x:box.width*x,y:box.height*y}})
 await page.getByRole('button',{name:'Aplicar zona (4 puntos)',exact:true}).click()
 assert.ok(new URL(page.url()).searchParams.has('poligono'))
 await page.getByRole('button',{name:'Quitar polígono',exact:true}).click()
 if(!mobile){await page.getByRole('button',{name:'Ver detalle de 2026-749',exact:true}).click();await page.getByRole('dialog').locator('.leaflet-container').waitFor();assert.match(await page.getByRole('dialog').textContent(),/Hash de origen/);await page.getByRole('button',{name:'Cerrar detalle',exact:true}).click()}
 await page.goto(base+'/analisis')
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`desborde ${width}`)}
 await page.setViewportSize(mobile?{width:390,height:844}:{width:1440,height:1000})
 if(process.env.AXE_PATH){await page.addScriptTag({path:process.env.AXE_PATH});const issues=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,targets:v.nodes.map(n=>n.target)})));assert.deepEqual(issues,[])}
 await page.screenshot({path:`.runtime/phase4/analisis-${mobile?'movil':'desktop'}.png`,fullPage:true})
 assert.ok(await page.evaluate(()=>sessionStorage.getItem('sismocore.catalogo.igp.v3')))
 await page.getByRole('button',{name:'Cerrar sesión',exact:true}).filter({visible:true}).click()
 await page.getByRole('button',{name:'Sí, cerrar sesión',exact:true}).click()
 await page.getByRole('heading',{name:'Iniciar sesión',exact:true}).waitFor()
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('sismocore.catalogo.igp.v3')),null)
 assert.deepEqual(errors,[]);console.log(`${mobile?'Móvil':'Escritorio'}: filtros compartidos, orden, gráficas, exportación, agrupación y polígono correctos.`)
 await context.close()
 }
}finally{await browser.close()}
