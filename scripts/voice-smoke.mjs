import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const base=process.env.SMOKE_URL||'http://127.0.0.1:5177'
const reference='22222222-2222-4222-8222-222222222222'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:393,height:851}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile})
  const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message))
  let calls=0;let completed=false;let configured=true;let role='administrador';let voiceReads=0
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;let json={}
   if(path.endsWith('/auth/me'))json={user:{id:'11111111-1111-4111-8111-111111111111',nombre_completo:'Prueba local',email:'test@example.invalid',rol:role,estado:'activo',permisos:['catalogo.leer','notificaciones.propias',...(role==='administrador'?['voz.probar']:[])]}}
   else if(path.endsWith('/notificaciones'))json={configurada:true,dispositivos:[],automaticas_activas:false}
   else if(path.endsWith('/eventos'))json={eventos:[],total:0,codigo_fuente:'igp',periodo_dias:30,consultado_en:new Date().toISOString()}
   else if(path.endsWith('/alertas/historial'))json={entregas:[]}
   else if(path.endsWith('/voz/pruebas')&&route.request().method()==='GET'){
    voiceReads++
    json={configurada:configured,automaticas:false,destinatarios:configured?[{id:'a'.repeat(64),etiqueta:'Perú · celular terminado en 1234'}]:[],
     limites:configured?{usadas_hoy:calls,usadas_total:calls,limite_diario:5,limite_total:50,espera_segundos:calls?60:0}:null,
     historial:calls?[{id:reference,fecha:'2026-10-24T12:00:00Z',ultimos:'1234',estado:completed?'completed':'queued'}]:[]}
   }else if(path.endsWith('/voz/pruebas')&&route.request().method()==='POST'){
    assert.deepEqual(route.request().postDataJSON(),{destino_id:'a'.repeat(64),confirmado:true});calls++
    json={id:reference,estado:'queued',message:'Twilio aceptó la solicitud. Comprueba si recibes la llamada y actualiza su estado; esto no confirma que hayas contestado.'}
   }else if(path.endsWith('/actualizar')){completed=true;json={estado:'completed'}}
   else throw new Error('Solicitud inesperada: '+path)
   await route.fulfill({json})
  })
  await page.route('**/health',route=>route.fulfill({json:{base_datos:'conectada',estado:'ok'}}))
  await page.goto(base+'/alertas')
  const button=page.getByRole('button',{name:'Realizar llamada de prueba',exact:true})
  await page.getByLabel('Destinatario de la llamada de prueba').waitFor()
  assert.equal(await button.isDisabled(),true)
  await page.getByLabel('Destinatario de la llamada de prueba').selectOption('a'.repeat(64))
  await button.click()
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(calls,0)
  await button.click()
  if(process.env.AXE_PATH){
   await page.addScriptTag({path:process.env.AXE_PATH})
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))
   assert.deepEqual(violations,[])
  }
  await page.getByRole('button',{name:'Sí, realizar llamada'}).click()
  await page.getByText('En cola de Twilio',{exact:true}).waitFor();assert.equal(calls,1)
  assert.equal(await button.isDisabled(),true)
  await page.getByRole('button',{name:'Consultar estado',exact:true}).click()
  await page.getByText('Llamada finalizada',{exact:true}).waitFor()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.screenshot({path:`.runtime/voice-${mobile?'android':'desktop'}.png`,fullPage:true})
  configured=false
  await page.getByRole('button',{name:'Actualizar llamadas',exact:true}).click()
  await page.getByText('Falta completar la configuración privada de Twilio en este servidor.',{exact:true}).waitFor()
  assert.equal(await button.isDisabled(),true)
  const oldReads=voiceReads;role='lectura';await page.reload()
  await page.getByRole('heading',{name:'Tus dispositivos',exact:true}).waitFor()
  assert.equal(await button.count(),0);assert.equal(voiceReads,oldReads);assert.deepEqual(errors,[])
  await context.close()
  console.log(`${mobile?'Celular':'Escritorio'}: selección, confirmación, cancelación, límites, historial y permisos verificados con llamadas simuladas.`)
 }
}finally{await browser.close()}
