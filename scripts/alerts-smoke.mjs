import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const base=process.env.SMOKE_URL||'http://127.0.0.1:5173'
const actor='11111111-1111-4111-8111-111111111111'
const ruleId='22222222-2222-4222-8222-222222222222'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:393,height:851}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile})
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
  let rules=[];let saves=0;let role='administrador';let ruleReads=0
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;let data={}
   if(path.endsWith('/auth/me')) data={user:{id:actor,email:'test@example.invalid',nombre_completo:'Prueba local',rol:role,estado:'activo',permisos:['catalogo.leer','notificaciones.propias',...(role==='administrador'?['alertas.administrar']:[])]}}
   else if(path.endsWith('/notificaciones')) data={configurada:true,dispositivos:[],automaticas_activas:false}
   else if(path.endsWith('/eventos')) data={eventos:[],total:0,periodo_dias:30,codigo_fuente:'igp',consultado_en:new Date().toISOString()}
   else if(path.endsWith('/alertas/historial')) data={entregas:[]}
   else if(path.endsWith('/alertas/reglas')&&route.request().method()==='GET'){ruleReads++;data={reglas:rules,destinatarios:[{id:actor,nombre_completo:'Prueba local',rol:'administrador'}]}}
   else if(path.includes('/alertas/reglas')&&['POST','PATCH'].includes(route.request().method())){
    const body=route.request().postDataJSON();saves++
    rules=[{...body,id:ruleId,version:saves,zona:body.zona||{},vigente_desde:new Date().toISOString()}]
    data={regla:rules[0]}
   }else throw new Error('Solicitud inesperada: '+path)
   await route.fulfill({json:data})
  })
  await page.route('**/health',route=>route.fulfill({json:{base_datos:'conectada',estado:'ok'}}))
  await page.goto(base+'/alertas')
  await page.getByRole('button',{name:'Nueva regla',exact:true}).click()
  await page.getByLabel('Nombre de la regla').fill('Sismos cerca de Lima')
  await page.getByLabel('Magnitud mínima').fill('4.5')
  await page.getByLabel('Zona de interés').selectOption('radio')
  await page.getByLabel('Latitud',{exact:true}).fill('-12.0464')
  await page.getByLabel('Longitud',{exact:true}).fill('-77.0428')
  await page.getByLabel('Radio (km)').fill('150')
  await page.getByLabel('Activar al guardar').check()
  if(process.env.AXE_PATH){
   await page.addScriptTag({path:process.env.AXE_PATH})
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))
   assert.deepEqual(violations,[])
  }
  await page.getByRole('button',{name:'Revisar regla'}).click()
  await page.getByRole('button',{name:'Cancelar',exact:true}).click()
  assert.equal(saves,0)
  await page.getByRole('button',{name:'Nueva regla',exact:true}).click()
  await page.getByLabel('Nombre de la regla').fill('Sismos del Peru')
  await page.getByLabel('Activar al guardar').check()
  await page.getByRole('button',{name:'Revisar regla'}).click()
  await page.getByRole('button',{name:'Confirmar y guardar'}).click()
  await page.getByRole('heading',{name:'Sismos del Peru',exact:true}).waitFor()
  assert.equal(saves,1);assert.equal(rules[0].activa,true);assert.deepEqual(rules[0].destinatarios,[actor])
  await page.getByRole('button',{name:'Pausar',exact:true}).click()
  await page.getByRole('button',{name:'Confirmar y guardar'}).click()
  await page.getByRole('button',{name:'Activar',exact:true}).waitFor()
  assert.equal(saves,2);assert.equal(rules[0].activa,false)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`.runtime/alert-rules-${mobile?'android':'desktop'}.png`,fullPage:true})
  const previousReads=ruleReads;role='lectura'
  await page.reload();await page.getByRole('heading',{name:'Tus avisos automáticos'}).waitFor()
  assert.equal(await page.getByRole('button',{name:'Nueva regla',exact:true}).count(),0)
  assert.equal(ruleReads,previousReads)
  assert.deepEqual(errors,[])
  await context.close()
  console.log(`${mobile?'Celular':'Escritorio'}: formulario, zona, destinatarios, confirmación, pausa y separación por rol comprobados sin envíos reales.`)
 }
}finally{await browser.close()}
