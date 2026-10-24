import { useEffect, useState, type FormEvent } from 'react'
import { Badge, Button, ConfirmDialog, Dialog, Panel } from '../../components/ui'
import { fecha } from '../../lib/format'
import { deliveryHistory, listRules, saveRule, ruleZone, type Channel, type Delivery, type Recipient, type Rule, type RuleInput } from '../../services/alerts'

export function Rules({ userId }: {userId:string}) {
  const [rules,setRules]=useState<Rule[]>([])
  const [recipients,setRecipients]=useState<Recipient[]>([])
  const [revision,setRevision]=useState(0)
  const [voiceAllowed,setVoiceAllowed]=useState(false)
  const [loaded,setLoaded]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const [editing,setEditing]=useState(false)
  const [id,setId]=useState<string>()
  const [draft,setDraft]=useState<RuleInput>({nombre:'',magnitud_minima:4,zona:null,destinatarios:[userId],activa:false})
  const [pending,setPending]=useState<{input:RuleInput;id?:string} | null>(null)
  const [busy,setBusy]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    void listRules(controller.signal).then(data=>{if(!controller.signal.aborted){setRules(data.reglas);setRecipients(data.destinatarios);setVoiceAllowed(!!data.permite_voz);setLoaded(true)}}).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'No se pudieron consultar las reglas.')})
    return ()=>controller.abort()
  },[revision])
  useEffect(()=>{const refresh=()=>setRevision(value=>value+1);window.addEventListener('voice-settings-changed',refresh);return()=>window.removeEventListener('voice-settings-changed',refresh)},[])
  const hasVoice=(draft.canales||['push']).includes('voz')
  const missingConsent=hasVoice&&draft.destinatarios.some(id=>!recipients.some(row=>row.id===id&&row.voz_activa&&row.rol==='administrador'))
  function edit(rule?:Rule){
    setError('');setMessage('');setId(rule?.id)
    setDraft(rule?{canales:rule.canales||['push'],nombre:rule.nombre,magnitud_minima:rule.magnitud_minima,zona:ruleZone(rule),destinatarios:rule.destinatarios,activa:rule.activa,version:rule.version}:{nombre:'',magnitud_minima:4,zona:null,destinatarios:[userId],activa:false})
    setEditing(true)
  }
  function review(event:FormEvent){event.preventDefault();setPending({input:draft,id});setEditing(false)}
  async function commit(){
    if(!pending||busy)return
    setBusy(true);setError('');setMessage('')
    try{await saveRule(pending.input,pending.id);setMessage(pending.input.activa?'Regla activada para eventos que ocurran a partir de ahora.':'Regla guardada en pausa.');setRevision(value=>value+1)}
    catch(failure){setError(failure instanceof Error?failure.message:'No se pudo guardar la regla.')}
    finally{setBusy(false);setPending(null)}
  }
  return <>
    <Panel title="Reglas de aviso" description="Define qué reportes nuevos del IGP se notificarán y a quiénes." action={<div className="push-actions"><Button icon="refresh" disabled={busy} onClick={()=>{setError('');setRevision(value=>value+1)}}>Actualizar reglas</Button><Button variant="primary" disabled={!loaded||busy||rules.length>=20} onClick={()=>edit()}>Nueva regla</Button></div>}>
      <p className="push-caption">Hasta 20 reglas. Se evalúan durante la sincronización programada, aproximadamente cada 10 minutos; puede haber retrasos. No se envían eventos anteriores a la activación ni reportes de más de dos horas.</p>
      {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="export-success" role="status">{message}</p>}
      {!loaded&&!error?<p role="status">Consultando reglas…</p>:!rules.length?<p>Aún no hay reglas. Crea una y selecciona los usuarios que recibirán los avisos en sus dispositivos activados.</p>:<ul className="push-devices">{rules.map(rule=><li key={rule.id}><div className="push-device-details"><h3>{rule.nombre}</h3><Badge tone={rule.activa?'success':'neutral'}>{rule.activa?'Activa':'En pausa'}</Badge><p>Magnitud ≥ {rule.magnitud_minima} · {'radio_km' in rule.zona?`Radio de ${rule.zona.radio_km} km`:'Catálogo del Perú'} · {rule.destinatarios.length} destinatarios</p><p>Canal: {(rule.canales||['push']).map(value=>value==='voz'?'Llamada':'Notificación').join(' + ')}</p><p>Vigencia: {fecha(rule.vigente_desde)} · Perú</p></div><div className="push-actions"><Button disabled={busy||(!voiceAllowed&&!!rule.canales?.includes('voz'))} onClick={()=>edit(rule)}>Editar</Button><Button variant="ghost" disabled={busy||(!voiceAllowed&&!!rule.canales?.includes('voz'))} onClick={()=>setPending({id:rule.id,input:{canales:rule.canales||['push'],nombre:rule.nombre,magnitud_minima:rule.magnitud_minima,zona:ruleZone(rule),destinatarios:rule.destinatarios,activa:!rule.activa,version:rule.version}})}>{rule.activa?'Pausar':'Activar'}</Button></div></li>)}</ul>}
    </Panel>
    <Dialog open={editing} title={id?'Editar regla':'Nueva regla de aviso'} eyebrow="AVISOS DEL IGP" description="Se notifican observaciones ya ocurridas. Selecciona solo usuarios que deban recibir estos avisos." onClose={()=>setEditing(false)}>
      <form className="push-rule-form" onSubmit={review}>
        <label className="field"><span>Nombre de la regla</span><input required maxLength={80} value={draft.nombre} onChange={event=>setDraft({...draft,nombre:event.target.value})}/></label>
        <label className="field"><span>Magnitud mínima</span><input type="number" required min={0} max={10} step="0.1" value={draft.magnitud_minima} onChange={event=>setDraft({...draft,magnitud_minima:Number(event.target.value)})}/></label>
        {voiceAllowed&&<label className="field"><span>Canal de aviso</span><select value={draft.canales?.length===2?'ambos':draft.canales?.[0]||'push'} onChange={event=>setDraft({...draft,canales:event.target.value==='ambos'?['push','voz']:[event.target.value as Channel]})}><option value="push">Notificación</option><option value="voz">Llamada</option><option value="ambos">Ambos</option></select></label>}
        <label className="field"><span>Zona de interés</span><select value={draft.zona?'radio':'peru'} onChange={event=>setDraft({...draft,zona:event.target.value==='radio'?{latitud:-12.0464,longitud:-77.0428,radio_km:100}:null})}><option value="peru">Todo el catálogo del Perú</option><option value="radio">Cerca de una ubicación</option></select></label>
        {draft.zona&&<fieldset className="push-zone"><legend>Centro y radio de la zona</legend>{(['latitud','longitud','radio_km'] as const).map(key=><label className="field" key={key}><span>{key==='radio_km'?'Radio (km)':key==='latitud'?'Latitud':'Longitud'}</span><input type="number" required min={key==='latitud'?-90:key==='longitud'?-180:10} max={key==='latitud'?90:key==='longitud'?180:2000} step="any" value={draft.zona![key]} onChange={event=>setDraft({...draft,zona:{...draft.zona!,[key]:Number(event.target.value)}})}/></label>)}</fieldset>}
        <fieldset className="push-recipients"><legend>Usuarios destinatarios ({draft.destinatarios.length}/50)</legend>{recipients.map(recipient=><label key={recipient.id}><input type="checkbox" checked={draft.destinatarios.includes(recipient.id)} disabled={!draft.destinatarios.includes(recipient.id)&&draft.destinatarios.length>=50} onChange={event=>setDraft({...draft,destinatarios:event.target.checked?[...draft.destinatarios,recipient.id]:draft.destinatarios.filter(value=>value!==recipient.id)})}/><span>{recipient.nombre_completo||'Usuario sin nombre'}{recipient.id===userId?' (tú)':''}{hasVoice?(recipient.voz_activa&&recipient.rol==='administrador'?` · Teléfono autorizado · ${recipient.voz_ultimos}`:' · Sin autorización de llamadas'):''}</span></label>)}</fieldset>
        <p className="push-caption">Las notificaciones requieren un dispositivo activado. Las llamadas requieren teléfono autorizado de un administrador y el control general habilitado.</p>
        {missingConsent&&<p className="inline-error">Para activar esta regla, todos los destinatarios deben autorizar su teléfono. Puedes guardarla en pausa.</p>}
        <label className="push-check"><input type="checkbox" checked={draft.activa} onChange={event=>setDraft({...draft,activa:event.target.checked})}/> Activar al guardar</label>
        <div className="push-actions"><Button onClick={()=>setEditing(false)}>Cancelar</Button><Button type="submit" variant="primary" disabled={!draft.destinatarios.length||!draft.nombre.trim()||(draft.activa&&missingConsent)}>Revisar regla</Button></div>
      </form>
    </Dialog>
    <ConfirmDialog open={!!pending} title={pending?.input.activa?'¿Activar esta regla?':'¿Guardar esta regla en pausa?'} description={pending?.input.activa?`Se enviarán avisos de eventos nuevos con magnitud ≥ ${pending.input.magnitud_minima} por ${(pending.input.canales||['push']).map(value=>value==='voz'?'llamada':'notificación').join(' y ')} a ${pending.input.destinatarios.length} usuarios seleccionados.${pending.input.canales?.includes('voz')?' Las llamadas consumen minutos Trial y comparten el límite de cinco intentos diarios y cincuenta en total.':''} No se notificará el catálogo histórico.`:'Se guardará la configuración y no se enviarán nuevos avisos de esta regla. Un envío que ya esté en curso podría completarse.'} confirmLabel="Confirmar y guardar" busy={busy} onCancel={()=>{if(!busy)setPending(null)}} onConfirm={()=>void commit()}/>
  </>
}

const callStates:Record<string,string>={queued:'Llamada en cola',initiated:'Iniciando llamada',ringing:'Sonando',
  'in-progress':'Llamada en curso',completed:'Llamada finalizada',busy:'Teléfono ocupado',failed:'Llamada fallida','no-answer':'Sin respuesta',canceled:'Llamada cancelada',desconocida:'Resultado incierto',rechazada:'Rechazada por Twilio'}
const states:Record<string,string>={pendiente:'En cola',procesando:'Envío en proceso',enviada:'Aceptada por Firebase',fallida:'Sin confirmación de envío',cancelada:'Cancelada o expirada'}
export function AlertHistory({manage=false}:{manage?:boolean}){
  const [rows,setRows]=useState<Delivery[]>([])
  const [error,setError]=useState('')
  const [loaded,setLoaded]=useState(false)
  const [revision,setRevision]=useState(0)
  const [all,setAll]=useState(false)
  useEffect(()=>{
    const controller=new AbortController()
    void deliveryHistory(controller.signal,all).then(data=>{if(!controller.signal.aborted){setRows(data.entregas);setLoaded(true);setError('')}}).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:'No se pudo consultar el historial.')})
    return ()=>controller.abort()
  },[revision,all])
  useEffect(()=>{const timer=window.setInterval(()=>{if(document.visibilityState==='visible')setRevision(value=>value+1)},30000);return()=>window.clearInterval(timer)},[])
  return <Panel title={all?'Historial de avisos':'Tus avisos automáticos'} description="Últimas 50 entregas del alcance seleccionado. Las pruebas manuales aparecen en la sección de dispositivos." action={<Button icon="refresh" onClick={()=>setRevision(value=>value+1)}>Actualizar historial</Button>}>
    {manage&&<label className="field"><span>Destinatarios del historial</span><select value={all?'todas':'propias'} onChange={event=>{setRows([]);setLoaded(false);setAll(event.target.value==='todas')}}><option value="propias">Solo mi cuenta</option><option value="todas">Todos los destinatarios</option></select></label>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
    {!loaded&&!error?<p role="status">Consultando historial…</p>:!rows.length?<p>Aún no hay avisos automáticos para tu cuenta.</p>:<ul className="push-devices">{rows.map(row=><li key={row.id}><div className="push-device-details"><h3>{row.alerta.titulo}</h3><Badge tone={row.estado==='enviada'?'success':row.estado==='fallida'?'warning':'neutral'}>{row.canal==='voz'?(callStates[row.estado_proveedor||'']||(row.estado==='enviada'?'Aceptada por Twilio':states[row.estado]||row.estado)):states[row.estado]||row.estado}</Badge><p>{row.alerta.mensaje}</p><p>{row.usuario?.nombre_completo||'Tu cuenta'} · {row.canal==='voz'?`Llamada · teléfono terminado en ${row.voz_ultimos}`:row.dispositivo?.etiqueta||'Dispositivo registrado'}</p><p>{fecha(row.creado_en)} · Perú · Regla: {row.alerta.contexto.regla||'Sin nombre'}</p>{row.error_codigo&&<p>{row.error_codigo==='LIMITE_SISMOCORE'?'Se alcanzó el límite compartido de llamadas de SISMOCORE.':row.error_codigo==='DESTINO_NO_DISPONIBLE'?'Actualiza y verifica el teléfono en la sección de llamadas.':row.error_codigo==='UNREGISTERED'?'Activa de nuevo las notificaciones de este dispositivo.':row.error_codigo==='RESULTADO_DESCONOCIDO'?'El proceso se interrumpió; no se reenvía automáticamente para evitar duplicados.':'No se confirmó el envío o el aviso dejó de estar vigente.'}</p>}<a href={row.alerta.url_fuente} target="_blank" rel="noreferrer">Ver reporte del IGP</a></div></li>)}</ul>}
    <p className="push-caption">La aceptación del proveedor no confirma entrega ni lectura; una llamada finalizada no confirma quién contestó. Si varias reglas coinciden, se genera un aviso por evento y dispositivo o teléfono.</p>
  </Panel>
}
