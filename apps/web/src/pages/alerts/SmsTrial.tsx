import { useEffect,useState } from 'react'
import { Badge,Button,ConfirmDialog,Panel } from '../../components/ui'
import AutomaticSms from './AutomaticSms'
import { fecha } from '../../lib/format'
import { loadSmsTrial,sendSmsTrial,refreshSmsTrial,type SmsTrialSettings } from '../../services/sms'

const states:Record<string,string>={solicitada:'Solicitud registrada',accepted:'Aceptado por Twilio',queued:'En cola',sending:'Enviando',sent:'Enviado al operador',delivered:'Entregado según Twilio',undelivered:'No entregado',failed:'Fallido',canceled:'Cancelado',desconocida:'Sin confirmación',rechazada:'Rechazado por Twilio'}
export default function SmsTrial(){
  const [data,setData]=useState<SmsTrialSettings|null>(null)
  const [revision,setRevision]=useState(0)
  const [target,setTarget]=useState('')
  const [busy,setBusy]=useState(false)
  const [confirm,setConfirm]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    void loadSmsTrial(controller.signal).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(failure=>{if(!controller.signal.aborted){setData(null);setError(failure instanceof Error?failure.message:'No se pudieron consultar los SMS.')}})
    return()=>controller.abort()
  },[revision])
  async function send(){
    if(busy||!target)return
    setBusy(true);setError('');setMessage('')
    try{setMessage((await sendSmsTrial(target)).message)}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo confirmar el envío. Revisa Twilio antes de repetirlo.')}
    finally{setBusy(false);setConfirm(false);setRevision(value=>value+1)}
  }
  async function refresh(id:string){
    setBusy(true);setError('')
    try{await refreshSmsTrial(id);setRevision(value=>value+1)}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo consultar el SMS.')}
    finally{setBusy(false)}
  }
  const selected=data?.destinatarios.find(row=>row.id===target)
  const limits=data?.limites
  const exhausted=!!limits&&(limits.usadas_hoy>=limits.limite_diario||limits.usadas_total>=limits.limite_total)
  return <>
    <AutomaticSms targets={data?.destinatarios||[]} revision={revision}/>
    <details className="alerts-tools"><summary>Probar un SMS<span>Comprobar recepción y ver pruebas recientes</span></summary>
    <Panel title="SMS de prueba" description="Comprueba la recepción de un mensaje de texto en tu teléfono." action={<Badge tone="info">Manual · Trial</Badge>}>
    <p className="push-caption">Esta prueba utiliza la plantilla de recordatorio de cita de tu consola de Twilio. La cuenta Trial no permite redactar un SMS sísmico personalizado; los SMS automáticos, si los habilitas, usarán esta misma plantilla.</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="export-success" role="status">{message}</p>}
    {!data&&!error&&<p role="status">Consultando Twilio…</p>}
    {data&&!data.configurada&&<p className="information-note">Falta la configuración privada de Twilio en el servidor.</p>}
    {data?.configurada&&<>
      <label className="field"><span>Destinatario del SMS de prueba</span><select value={selected?target:''} disabled={busy} onChange={event=>setTarget(event.target.value)}><option value="">Selecciona un teléfono</option>{data.destinatarios.map(row=><option key={row.id} value={row.id}>{row.etiqueta}</option>)}</select></label>
      {!data.destinatarios.length&&<p className="information-note">Completa primero una prueba desde Try out SMS en Twilio a un teléfono verificado y después actualiza esta lista. También se reconocen los destinos disponibles de las llamadas.</p>}
      {limits&&<p className="push-caption">Intentos de SISMOCORE: {limits.usadas_hoy}/{limits.limite_diario} hoy · {limits.usadas_total}/{limits.limite_total} en total. Se cuenta cada solicitud, incluso si falla; no son tus unidades restantes de Twilio.</p>}
      {exhausted&&<p className="inline-error">Se alcanzó el límite de pruebas SMS.</p>}
      {!!limits?.espera_segundos&&<p className="push-caption">Espera aproximadamente {limits.espera_segundos} segundos antes de otra prueba.</p>}
    </>}
    <div className="push-actions"><Button variant="primary" disabled={busy||!selected||exhausted||!!limits?.espera_segundos} onClick={()=>setConfirm(true)}>Enviar SMS de prueba</Button><Button icon="refresh" disabled={busy} onClick={()=>{setError('');setRevision(value=>value+1)}}>Actualizar SMS</Button></div>
    {!!data?.historial.length&&<details className="alerts-help"><summary>Pruebas SMS recientes ({data.historial.length})</summary><ul className="push-devices">{data.historial.map(row=><li key={row.id}><div className="push-device-details"><h3>Teléfono terminado en {row.ultimos}</h3><Badge tone={['failed','undelivered','desconocida','rechazada'].includes(row.estado)?'warning':row.estado==='delivered'?'success':'neutral'}>{states[row.estado]||row.estado}</Badge><p>{fecha(row.fecha)} · Perú</p></div>{['accepted','queued','sending','sent'].includes(row.estado)&&<Button disabled={busy} onClick={()=>void refresh(row.id)}>Consultar SMS</Button>}</li>)}</ul></details>}
    <details className="alerts-help"><summary>Condiciones de esta prueba</summary><p>Se permite un intento por minuto, cinco por día y cincuenta en total. Cada solicitud puede consumir unidades Trial de SMS. No hay reintentos automáticos. Un SMS aceptado no garantiza entrega y un SMS entregado no confirma lectura.</p><p>El remitente y la plantilla los determina Twilio para esta cuenta Trial. Si el proveedor rechaza el envío, revisa Try out SMS antes de repetirlo.</p></details>
    <ConfirmDialog open={confirm} title="¿Enviar un SMS de prueba?" description={`Se enviará la plantilla de recordatorio de cita de Twilio a ${selected?.etiqueta||'tu teléfono seleccionado'}. Es un mensaje de ejemplo, no una alerta sísmica real. Puede consumir unidades de tu cuenta Trial.`} confirmLabel="Sí, enviar SMS" busy={busy} onCancel={()=>{if(!busy)setConfirm(false)}} onConfirm={()=>void send()}/>
  </Panel></details>
  </>
}
