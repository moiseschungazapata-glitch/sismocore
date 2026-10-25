import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, Panel } from '../../components/ui'
import { fecha,number } from '../../lib/format'
import { loadVoiceTrial, startVoiceTrial, refreshVoiceTrial, type VoiceTrial as Trial } from '../../services/voice'
import AutomaticVoice from './AutomaticVoice'

const states:Record<string,string>={solicitada:'Solicitud registrada',queued:'En cola de Twilio',initiated:'Iniciando',ringing:'Sonando',
  'in-progress':'Llamada en curso',completed:'Llamada finalizada',busy:'Teléfono ocupado',failed:'Fallida',
  'no-answer':'Sin respuesta',canceled:'Cancelada',desconocida:'Sin confirmación',rechazada:'Rechazada por Twilio'}

const eventTime=(value:string)=>new Intl.DateTimeFormat('es-PE',{timeZone:'America/Lima',dateStyle:'medium',timeStyle:'medium'}).format(new Date(value))

export default function VoiceTrial(){
  const [data,setData]=useState<Trial|null>(null)
  const [revision,setRevision]=useState(0)
  const [target,setTarget]=useState('')
  const [busy,setBusy]=useState(false)
  const [confirm,setConfirm]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{
    const controller=new AbortController()
    void loadVoiceTrial(controller.signal).then(value=>{if(!controller.signal.aborted)setData(value)}).catch(failure=>{if(!controller.signal.aborted){setData(null);setError(failure instanceof Error?failure.message:'No se pudo consultar Twilio.')}})
    return()=>controller.abort()
  },[revision])
  async function call(){
    if(busy||!target||!data?.ultimo_evento)return
    setBusy(true);setError('');setMessage('')
    try{setMessage((await startVoiceTrial(target,data.ultimo_evento)).message)}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo confirmar la solicitud. Consulta Twilio antes de volver a intentarlo.')}
    finally{setBusy(false);setConfirm(false);setRevision(value=>value+1)}
  }
  async function refresh(id:string){
    setBusy(true);setError('')
    try{await refreshVoiceTrial(id);setRevision(value=>value+1)}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo consultar el estado.')}
    finally{setBusy(false)}
  }
  const selected=data?.destinatarios.find(value=>value.id===target)
  const limit=data?.limites
  const exhausted=!!limit&&(limit.usadas_hoy>=limit.limite_diario||limit.usadas_total>=limit.limite_total)
  return <>
    <AutomaticVoice targets={data?.destinatarios||[]} revision={revision}/>
    <details className="alerts-tools"><summary>Probar una llamada<span>Escuchar el último evento del IGP y comprobar recepción</span></summary>
    <Panel title="Llamada con el último evento" description="Demostración manual con una observación real guardada del IGP.">
      {error&&<p className="inline-error" role="alert">{error}</p>}
      {!data&&!error&&<p role="status">Comprobando Twilio…</p>}
      {data&&!data.configurada&&<p>Falta completar la configuración privada de Twilio en este servidor.</p>}
      {data?.configurada&&<>

        {data.ultimo_evento?<div className="voice-event-preview"><Badge tone="info">IGP · {data.ultimo_evento.id_externo}</Badge><h3>{data.ultimo_evento.lugar}</h3><p><strong>Magnitud {number(data.ultimo_evento.magnitud)}</strong> · profundidad {number(data.ultimo_evento.profundidad)} km</p><p>Ocurrió: {eventTime(data.ultimo_evento.ocurrido_en)} · hora de Perú</p><p className="field-help">La llamada leerá este evento con su fecha y hora exactas, incluidos los segundos. Es una demostración manual de un evento ya ocurrido; no genera una alerta nueva.</p></div>:<p className="information-note">No hay un evento IGP completo disponible. Actualiza el catálogo y esta sección antes de realizar la llamada.</p>}
        <label className="field"><span>Destinatario de la llamada de prueba</span><select value={selected?target:''} onChange={event=>setTarget(event.target.value)} disabled={busy}><option value="">Selecciona tu teléfono</option>{data.destinatarios.map(value=><option key={value.id} value={value.id}>{value.etiqueta}</option>)}</select></label>
        {!data.destinatarios.length&&<p className="information-note">No se encontró un destino disponible. Realiza primero una llamada completada desde la consola de Twilio al número verificado, usando el remitente configurado, y actualiza esta sección.</p>}
        {limit&&<p className="push-caption">Intentos compartidos: {limit.usadas_hoy}/{limit.limite_diario} hoy · {limit.usadas_total}/{limit.limite_total} en total.</p>}
        {exhausted&&<p className="inline-error">Se alcanzó el límite de pruebas de SISMOCORE.</p>}
        {!!limit&&limit.espera_segundos>0&&<p className="push-caption">Espera aproximadamente {limit.espera_segundos} segundos y actualiza antes de otra prueba.</p>}
      </>}
      <div className="push-actions"><Button variant="primary" loading={busy} disabled={!selected||!data?.ultimo_evento||!data?.configurada||exhausted||!!limit?.espera_segundos} onClick={()=>setConfirm(true)}>Realizar llamada de prueba</Button><Button icon="refresh" disabled={busy} onClick={()=>{setError('');setRevision(value=>value+1)}}>Actualizar llamadas</Button></div>
      <details className="alerts-help"><summary>¿No aparece un número verificado en Twilio?</summary><p>En la nueva cuenta Trial, los destinatarios de Try out Voice pueden no aparecer en la lista clásica de números verificados que consulta SISMOCORE. En ese caso, completa una llamada desde Try out Voice al nuevo número usando el remitente configurado y después pulsa Actualizar llamadas.</p><p>El teléfono autorizado para avisos automáticos es una configuración independiente de tu cuenta: actualizar los destinatarios de prueba no cambia esa autorización.</p></details>
      {message&&<p className="export-success" role="status">{message}</p>}
      {!!data?.historial.length&&<details className="alerts-help alerts-trial-history" open={data.historial.some(row=>['queued','initiated','ringing','in-progress'].includes(row.estado))}><summary>Pruebas recientes ({data.historial.length})</summary><ul className="push-devices">{data.historial.map(row=><li key={row.id}><div className="push-device-details"><h3>Teléfono terminado en {row.ultimos}</h3><Badge tone={['failed','rechazada','desconocida'].includes(row.estado)?'warning':'neutral'}>{states[row.estado]||row.estado}</Badge><p>{fecha(row.fecha)} · Perú</p>{row.estado==='desconocida'&&<p>El resultado es incierto. Consulta los registros de Twilio antes de repetir la llamada.</p>}</div>{['queued','initiated','ringing','in-progress'].includes(row.estado)&&<Button disabled={busy} onClick={()=>void refresh(row.id)}>Consultar estado</Button>}</li>)}</ul></details>}
      <p className="push-caption">Consume minutos Trial. Un intento por minuto, sin reintentos automáticos. «Finalizada» no confirma quién contestó.</p>
    </Panel>
    </details>
    <ConfirmDialog open={confirm} title="¿Llamar con el último evento registrado?" description={`Se llamará a ${selected?.etiqueta||'tu teléfono seleccionado'} con el reporte IGP ${data?.ultimo_evento?.id_externo||''}, magnitud ${data?.ultimo_evento?.magnitud??''}, ocurrido el ${fecha(data?.ultimo_evento?.ocurrido_en)} (Perú). Escucharás ubicación, profundidad y hora con segundos. Es una demostración manual de un evento ya ocurrido y consumirá cuota Trial.`} confirmLabel="Sí, realizar llamada" busy={busy} onCancel={()=>{if(!busy)setConfirm(false)}} onConfirm={()=>void call()}/>
  </>
}
