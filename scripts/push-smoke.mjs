import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright')
const base = process.env.SMOKE_URL || 'http://127.0.0.1:5173'
const id='22222222-2222-4222-8222-222222222222'
const user={ id:'11111111-1111-4111-8111-111111111111',email:'test@example.invalid',nombre_completo:'Prueba local',rol:'lectura',estado:'activo',permisos:['catalogo.leer','notificaciones.propias'] }
const browser=await chromium.launch({ channel:'chrome',headless:true })
try {
  for (const mobile of [false,true]) {
    const context=await browser.newContext({viewport:mobile ? {width:393,height:851} : {width:1365,height:900},isMobile:mobile,hasTouch:mobile,permissions:['notifications']})
    await context.addInitScript(({id,userId}) => localStorage.setItem('sismocore.push-device.v1',JSON.stringify({id,userId})),{id,userId:user.id})
    const page=await context.newPage()
    const errors=[]; page.on('pageerror',error=>errors.push(error.message))
    let configured=false; let active=true; let sends=0; let deactivations=0
    await page.route('**/api/v1/**',async route => {
      const path=new URL(route.request().url()).pathname
      let body={}
      if (path.endsWith('/alertas/historial')) body={entregas:[]}
      else if (path.endsWith('/auth/me')) body={user}
      else if(path.endsWith('/notificaciones')) body={configurada:configured,automaticas_activas:false,dispositivos:active ? [{id,etiqueta:'Chrome en Android',activo:true,registrado_en:'2026-10-24T01:00:00Z',ultima_prueba_en:null}] : []}
      else if(path.endsWith('/prueba')) { sends++; body={estado:'aceptada',message:'Firebase aceptó la notificación de prueba. Comprueba su recepción en este dispositivo.'} }
      else if(path.endsWith('/desactivar')) { deactivations++; active=false; body={message:'Desactivado'} }
      else if(path.endsWith('/eventos')) body={eventos:[],total:0,periodo_dias:30,codigo_fuente:'igp',consultado_en:new Date().toISOString()}
      else throw new Error('API inesperada: '+path)
      await route.fulfill({json:body})
    })
    await page.route('**/health',route=>route.fulfill({json:{base_datos:'conectada',estado:'ok'}}))
    await page.goto(base+'/alertas')
    await page.getByRole('heading',{name:'Tus dispositivos',exact:true}).waitFor()
    await page.getByText('Envío pendiente de configuración.',{exact:true}).waitFor()
    assert.equal(await page.getByRole('button',{name:'Enviar prueba',exact:true}).isDisabled(),true)
    configured=true
    await page.getByRole('button',{name:'Actualizar lista'}).click()
    await page.getByText('Envío pendiente de configuración.',{exact:true}).waitFor({state:'detached'})
    await page.getByRole('button',{name:'Enviar prueba',exact:true}).click()
    await page.getByRole('button',{name:'Cancelar',exact:true}).click()
    assert.equal(sends,0)
    await page.getByRole('button',{name:'Enviar prueba',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Enviar prueba',exact:true}).click()
    await page.getByText('Firebase aceptó la notificación de prueba. Comprueba su recepción en este dispositivo.',{exact:true}).waitFor()
    assert.equal(sends,1)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
    if (process.env.AXE_PATH) {
      await page.addScriptTag({path:process.env.AXE_PATH})
      const issues=await page.evaluate(async()=> (await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(issue=>({id:issue.id,nodes:issue.nodes.map(node=>node.target)})))
      assert.deepEqual(issues,[])
    }
    await page.screenshot({path:`.runtime/push-${mobile?'android':'desktop'}.png`,fullPage:true})
    // Test activation error without contacting Firebase or producing a device token.
    await page.evaluate(()=>{Notification.requestPermission=async()=> 'denied'})
    await page.getByRole('button',{name:'Renovar activación'}).click()
    await page.getByText('Las notificaciones están bloqueadas. Permítelas en la configuración del sitio de Chrome y vuelve a intentarlo.',{exact:true}).waitFor()
    // Real bundled service worker installs without a push subscription or server send.
    const worker=await page.evaluate(async()=>{
      const registration=await navigator.serviceWorker.register('/firebase-messaging-sw.js',{type:'module',scope:'/'})
      await navigator.serviceWorker.ready
      const url=registration.active?.scriptURL
      await registration.unregister()
      return url
    })
    assert.ok(worker?.endsWith('/firebase-messaging-sw.js'))
    await page.getByRole('button',{name:'Desactivar',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Desactivar',exact:true}).click()
    await page.getByText('Aún no tienes dispositivos activados.',{exact:false}).waitFor()
    assert.equal(deactivations,1)
    assert.equal(await page.evaluate(()=>localStorage.getItem('sismocore.push-device.v1')),null)
    assert.deepEqual(errors,[])
    await context.close()
    console.log(`${mobile?'Android (vista simulada)':'Escritorio'}: confirmaciones, bloqueo sin credencial, permisos, prueba simulada, revocación y receptor verificados.`)
  }
} finally { await browser.close() }
