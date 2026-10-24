import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, Panel } from '../../components/ui'
import { authorizeVoicePhone, loadAutomaticVoice, revokeVoicePhone, switchAutomaticVoice, type AutomaticVoiceSettings } from '../../services/voice'

export default function AutomaticVoice({targets,revision}:{targets:{id:string;etiqueta:string}[];revision:number}){
  const [data,setData]=useState<AutomaticVoiceSettings|null>(null)
  const [target,setTarget]=useState('')
  const [version,setVersion]=useState(0)
  const [pending,setPending]=useState<'autorizar'|'retirar'|'activar'|'pausar'|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{let live=true;void loadAutomaticVoice().then(value=>{if(live){setData(value);setError('')}}).catch(failure=>{if(live)setError(failure instanceof Error?failure.message:'No se pudo consultar la configuración.')});return()=>{live=false}},[revision,version])
  async function save(){
    if(!pending||busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const result=pending==='autorizar'?await authorizeVoicePhone(target):pending==='retirar'?await revokeVoicePhone():await switchAutomaticVoice(pending==='activar')
      setMessage(result.message);setVersion(value=>value+1);window.dispatchEvent(new Event('voice-settings-changed'))
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo guardar la configuración.')}
    finally{setBusy(false);setPending(null)}
  }
  const descriptions={autorizar:'Autorizas recibir llamadas de SISMOCORE en el teléfono seleccionado. Debes haber completado una prueba manual desde esta cuenta. Las llamadas consumen minutos Trial; autorizar el teléfono no enciende el control general.',retirar:'Se retirará tu autorización y se cancelarán tus llamadas pendientes. Una llamada que ya esté en curso podría terminar.',activar:'Se habilitarán las reglas de llamada para nuevos reportes del IGP. Se comparten cinco intentos diarios, cincuenta en total y un minuto de espera con las pruebas manuales. Las llamadas consumen minutos Trial.',pausar:'Se cancelarán las llamadas pendientes. Las llamadas que ya estén en curso podrían terminar. Las notificaciones seguirán sus propias reglas.'}
  return <Panel title="Llamadas automáticas" description="Avisos por voz de eventos reportados por el IGP que coincidan con tus reglas." action={<Badge tone={data?.habilitadas?'warning':'neutral'}>{data?.habilitadas?'Habilitadas':'Pausadas'}</Badge>}>
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="export-success" role="status">{message}</p>}
    {!data&&!error&&<p role="status">Consultando configuración…</p>}
    {data&&<>
      <p>{data.telefono.activo?`Tu teléfono terminado en ${data.telefono.ultimos} está autorizado.`:'Tu cuenta todavía no tiene un teléfono autorizado para llamadas automáticas.'}</p>
      {!data.telefono.activo&&<label className="field"><span>Tu teléfono verificado</span><select value={target} disabled={busy} onChange={event=>setTarget(event.target.value)}><option value="">Selecciona tu teléfono</option>{targets.map(row=><option value={row.id} key={row.id}>{row.etiqueta}</option>)}</select></label>}
      <div className="push-actions">
        {data.telefono.activo?<Button disabled={busy} onClick={()=>setPending('retirar')}>Retirar autorización</Button>:<Button disabled={busy||!data.configurada||!targets.some(row=>row.id===target)} onClick={()=>setPending('autorizar')}>Autorizar mi teléfono</Button>}
        <Button variant="primary" disabled={busy||(!data.habilitadas&&(!data.configurada||!data.telefono.activo))} onClick={()=>setPending(data.habilitadas?'pausar':'activar')}>{data.habilitadas?'Pausar llamadas automáticas':'Habilitar llamadas automáticas'}</Button>
        <Button icon="refresh" disabled={busy} onClick={()=>setVersion(value=>value+1)}>Actualizar configuración</Button>
      </div>
      {data.habilitadas&&!data.cuenta_coincide&&<p className="inline-error">La cuenta de Twilio cambió. Pausa y vuelve a configurar las llamadas.</p>}
      <p className="push-caption">Crea una regla con el canal Llamada o Ambos y selecciona tu cuenta. Durante esta etapa Trial solo se permiten teléfonos autorizados de administradores. Se realiza como máximo una llamada por sincronización y no se reintenta un resultado incierto.</p>
      <p className="push-caption">Son avisos de sismos ya ocurridos; no anticipan un terremoto. El procesamiento programado puede tener retrasos.</p>
    </>}
    <ConfirmDialog open={!!pending} title={pending==='autorizar'?'¿Autorizar tu teléfono?':pending==='retirar'?'¿Retirar la autorización?':pending==='activar'?'¿Habilitar llamadas automáticas?':'¿Pausar llamadas automáticas?'} description={pending?descriptions[pending]:''} confirmLabel="Sí, confirmar" busy={busy} onCancel={()=>{if(!busy)setPending(null)}} onConfirm={()=>void save()}/>
  </Panel>
}
