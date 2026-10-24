import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, Panel } from '../../components/ui'
import { fecha } from '../../lib/format'
import { loadVoiceTrial, startVoiceTrial, refreshVoiceTrial, type VoiceTrial as Trial } from '../../services/voice'

const states:Record<string,string>={solicitada:'Solicitud registrada',queued:'En cola de Twilio',initiated:'Iniciando',ringing:'Sonando',
  'in-progress':'Llamada en curso',completed:'Llamada finalizada',busy:'Teléfono ocupado',failed:'Fallida',
  'no-answer':'Sin respuesta',canceled:'Cancelada',desconocida:'Sin confirmación',rechazada:'Rechazada por Twilio'}

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
    if(busy||!target)return
    setBusy(true);setError('');setMessage('')
    try{setMessage((await startVoiceTrial(target)).message)}
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
    <Panel title="Llamadas de prueba" description="Pruebas manuales de voz para el administrador, usando la cuenta Trial de Twilio." action={<Badge tone="info">Solo pruebas manuales</Badge>}>
      {error&&<p className="inline-error" role="alert">{error}</p>}
      {!data&&!error&&<p role="status">Comprobando Twilio…</p>}
      {data&&!data.configurada&&<p>Falta completar la configuración privada de Twilio en este servidor.</p>}
      {data?.configurada&&<>
        <p>El teléfono recibirá el mensaje: «Esta es una prueba de SISMOCORE. No representa una alerta sísmica real».</p>
        <label className="field"><span>Destinatario de la llamada de prueba</span><select value={selected?target:''} onChange={event=>setTarget(event.target.value)} disabled={busy}><option value="">Selecciona tu teléfono</option>{data.destinatarios.map(value=><option key={value.id} value={value.id}>{value.etiqueta}</option>)}</select></label>
        {!data.destinatarios.length&&<p className="information-note">No se encontró un destino disponible. Realiza primero una llamada completada desde la consola de Twilio al número verificado, usando el remitente configurado, y actualiza esta sección.</p>}
        {limit&&<p className="push-caption">Límite de SISMOCORE: {limit.usadas_hoy}/{limit.limite_diario} intentos hoy · {limit.usadas_total}/{limit.limite_total} en total. Se cuenta cada solicitud, incluso si falla. Estos contadores no representan los minutos restantes de Twilio.</p>}
        {exhausted&&<p className="inline-error">Se alcanzó el límite de pruebas de SISMOCORE.</p>}
        {!!limit&&limit.espera_segundos>0&&<p className="push-caption">Espera aproximadamente {limit.espera_segundos} segundos y actualiza antes de otra prueba.</p>}
      </>}
      <div className="push-actions"><Button variant="primary" loading={busy} disabled={!selected||!data?.configurada||exhausted||!!limit?.espera_segundos} onClick={()=>setConfirm(true)}>Realizar llamada de prueba</Button><Button icon="refresh" disabled={busy} onClick={()=>{setError('');setRevision(value=>value+1)}}>Actualizar llamadas</Button></div>
      {message&&<p className="export-success" role="status">{message}</p>}
      {!!data?.historial.length&&<ul className="push-devices">{data.historial.map(row=><li key={row.id}><div className="push-device-details"><h3>Teléfono terminado en {row.ultimos}</h3><Badge tone={['failed','rechazada','desconocida'].includes(row.estado)?'warning':'neutral'}>{states[row.estado]||row.estado}</Badge><p>{fecha(row.fecha)} · Perú</p>{row.estado==='desconocida'&&<p>El resultado es incierto. Consulta los registros de Twilio antes de repetir la llamada.</p>}</div>{['queued','initiated','ringing','in-progress'].includes(row.estado)&&<Button disabled={busy} onClick={()=>void refresh(row.id)}>Consultar estado</Button>}</li>)}</ul>}
      <p className="push-caption">Cada llamada puede consumir minutos de la prueba. El mensaje es breve y finaliza con una instrucción de colgar; hay un minuto de espera entre intentos. No hay llamadas automáticas ni reintentos automáticos. «Finalizada» no confirma quién contestó.</p>
    </Panel>
    <ConfirmDialog open={confirm} title="¿Realizar una llamada de prueba?" description={`Se llamará a ${selected?.etiqueta||'tu teléfono seleccionado'} con el mensaje de prueba de SISMOCORE. Consumirá parte de tu cuota Trial de Twilio. No representa una alerta real.`} confirmLabel="Sí, realizar llamada" busy={busy} onCancel={()=>{if(!busy)setConfirm(false)}} onConfirm={()=>void call()}/>
  </>
}
