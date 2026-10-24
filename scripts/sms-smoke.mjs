import assert from 'node:assert/strict'
import {pathToFileURL} from 'node:url'
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE?pathToFileURL(process.env.PLAYWRIGHT_MODULE).href:'playwright')
const base=process.env.SMOKE_URL||'http://127.0.0.1:5179'
const ref='22222222-2222-4222-8222-222222222222'
const browser=await chromium.launch({channel:'chrome',headless:true})
try{
 for(const mobile of [false,true]){
  const context=await browser.newContext({viewport:mobile?{width:393,height:851}:{width:1365,height:900},isMobile:mobile,hasTouch:mobile})
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message))
  let enabled=false,linked=false,settingsWrites=0;let sends=0,reads=0,configured=false,delivered=false,role='administrador'
  await page.route('**/api/v1/**',async route=>{
   const path=new URL(route.request().url()).pathname;let json={}
   if(path.endsWith('/auth/me'))json={user:{id:'11111111-1111-4111-8111-111111111111',nombre_completo:'Prueba local',email:'test@example.invalid',rol:role,estado:'activo',permisos:['catalogo.leer','notificaciones.propias',...(role==='administrador'?['voz.probar']:[])]}}
   else if(path.endsWith('/notificaciones'))json={configurada:true,dispositivos:[],automaticas_activas:false}
   else if(path.endsWith('/eventos'))json={eventos:[],total:0,codigo_fuente:'igp',periodo_dias:30,consultado_en:new Date().toISOString()}
   else if(path.endsWith('/sms/automaticos')&&route.request().method()==='GET')json={configurada:configured,habilitadas:enabled,cuenta_coincide:true,telefono:{activo:linked,ultimos:linked?'1234':null,autorizado_en:null}}
   else if(path.endsWith('/sms/automaticos')){assert.equal(route.request().postDataJSON().demostracion_trial,true);enabled=route.request().postDataJSON().activa;settingsWrites++;json={message:'Configuración SMS guardada'}}
   else if(path.endsWith('/sms/telefono')){assert.equal(route.request().postDataJSON().demostracion_trial,true);linked=true;settingsWrites++;json={message:'Autorización SMS guardada'}}
   else if(path.endsWith('/sms/pruebas')&&route.request().method()==='GET'){
    reads++;json={configurada:configured,destinatarios:configured?[{id:'a'.repeat(64),etiqueta:'Perú · celular terminado en 1234'}]:[],limites:configured?{usadas_hoy:sends,usadas_total:sends,limite_diario:5,limite_total:50,espera_segundos:sends?60:0}:null,historial:sends?[{id:ref,fecha:'2026-10-24T12:00:00Z',ultimos:'1234',estado:delivered?'delivered':'queued'}]:[]}
   }else if(path.endsWith('/sms/pruebas')){
    assert.deepEqual(route.request().postDataJSON(),{destino_id:'a'.repeat(64),confirmado:true});sends++;json={message:'Twilio aceptó el SMS de prueba.'}
   }else if(path.endsWith('/actualizar')){delivered=true;json={estado:'delivered'}}
   else throw new Error('API inesperada: '+path)
   await route.fulfill({json})
  })
  await page.route('**/health',route=>route.fulfill({json:{base_datos:'conectada',estado:'ok'}}))
  await page.goto(base+'/alertas');assert.equal(reads,0)
  await page.getByRole('button',{name:'SMS Pruebas y automatización',exact:true}).click()
  await page.locator('.alerts-tools > summary').filter({hasText:'Probar un SMS'}).click()
  await page.getByText('Falta la configuración privada de Twilio en el servidor.',{exact:true}).waitFor()
  const button=page.getByRole('button',{name:'Enviar SMS de prueba',exact:true})
  assert.equal(await button.isDisabled(),true)
  configured=true;await page.getByRole('button',{name:'Actualizar SMS',exact:true}).click()
  await page.getByLabel('Destinatario del SMS de prueba').selectOption('a'.repeat(64))
  await button.click();await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(sends,0)
  await button.click()
  if(process.env.AXE_PATH){
   await page.addScriptTag({path:process.env.AXE_PATH})
   const violations=await page.evaluate(async()=>(await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})))
   assert.deepEqual(violations,[])
  }
  await page.getByRole('button',{name:'Sí, enviar SMS',exact:true}).click()
  await page.getByText('Twilio aceptó el SMS de prueba.',{exact:true}).waitFor();assert.equal(sends,1)
  assert.equal(await button.isDisabled(),true)
  await page.locator('summary').filter({hasText:'Pruebas SMS recientes'}).click()
  await page.getByRole('button',{name:'Consultar SMS',exact:true}).click()
  await page.getByText('Entregado según Twilio',{exact:true}).waitFor();assert.equal(sends,1)
  await page.getByLabel('Tu teléfono para SMS').selectOption('a'.repeat(64))
  await page.getByRole('button',{name:'Autorizar mi teléfono para SMS',exact:true}).click()
  await page.getByRole('button',{name:'Cancelar',exact:true}).click();assert.equal(settingsWrites,0)
  await page.getByRole('button',{name:'Autorizar mi teléfono para SMS',exact:true}).click()
  await page.getByRole('button',{name:'Sí, confirmar SMS',exact:true}).click()
  await page.getByRole('button',{name:'Retirar autorización SMS',exact:true}).waitFor();assert.equal(enabled,false)
  await page.getByRole('button',{name:'Habilitar SMS automáticos',exact:true}).click()
  await page.getByRole('dialog').getByText(/No incluye magnitud/).waitFor()
  await page.getByRole('button',{name:'Sí, confirmar SMS',exact:true}).click()
  await page.getByRole('button',{name:'Pausar SMS automáticos',exact:true}).waitFor();assert.equal(enabled,true)
  await page.getByRole('button',{name:'Pausar SMS automáticos',exact:true}).click()
  await page.getByRole('button',{name:'Sí, confirmar SMS',exact:true}).click()
  await page.getByRole('button',{name:'Habilitar SMS automáticos',exact:true}).waitFor();assert.equal(enabled,false);assert.equal(sends,1)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo(0,0)})
  await page.screenshot({path:`.runtime/sms-${mobile?'android':'desktop'}.png`,fullPage:true})
  const oldReads=reads;role='lectura';await page.reload();await page.getByRole('heading',{name:'Tus dispositivos',exact:true}).waitFor()
  assert.equal(await page.getByRole('button',{name:'SMS Pruebas y automatización',exact:true}).count(),0);assert.equal(reads,oldReads);assert.deepEqual(errors,[])
  await context.close();console.log(`${mobile?'Android':'Escritorio'}: selección, confirmación, cancelación, límites, historial y permisos SMS comprobados sin envíos reales.`)
 }
}finally{await browser.close()}
