import { useEffect,useState } from 'react'
import { Badge,Button,ConfirmDialog,Panel } from '../../components/ui'
import { authorizeSmsPhone,loadAutomaticSms,revokeSmsPhone,switchAutomaticSms,type AutomaticSmsSettings } from '../../services/sms'

export default function AutomaticSms({targets,revision}:{targets:{id:string;etiqueta:string}[];revision:number}){
  const [data,setData]=useState<AutomaticSmsSettings|null>(null)
  const [target,setTarget]=useState('')
  const [version,setVersion]=useState(0)
  const [pending,setPending]=useState<'autorizar'|'retirar'|'activar'|'pausar'|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  useEffect(()=>{let live=true;void loadAutomaticSms().then(value=>{if(live){setData(value);setError('')}}).catch(failure=>{if(live)setError(failure instanceof Error?failure.message:'No se pudo consultar la configuración SMS.')});return()=>{live=false}},[revision,version])
  async function save(){
    if(!pending||busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const result=pending==='autorizar'?await authorizeSmsPhone(target):pending==='retirar'?await revokeSmsPhone():await switchAutomaticSms(pending==='activar')
      setMessage(result.message);setVersion(value=>value+1);window.dispatchEvent(new Event('voice-settings-changed'))
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo guardar la configuración SMS.')}
    finally{setBusy(false);setPending(null)}
  }
  const descriptions={autorizar:'Autorizas que tu teléfono reciba una plantilla de recordatorio de cita de Twilio cuando un evento nuevo coincida con tus reglas SMS. No contiene datos del sismo ni constituye una alerta sísmica. Requiere una prueba SMS entregada desde tu cuenta y consume cuota Trial.',retirar:'Se retirará tu autorización SMS y se cancelarán tus envíos pendientes. Uno que ya esté en curso podría completarse.',activar:'Los eventos nuevos que coincidan con reglas SMS activas dispararán una plantilla de recordatorio de cita de Twilio. No incluye magnitud, ubicación ni fecha del sismo. Es una demostración Trial: comparte cinco intentos diarios, cincuenta en total y un minuto de espera con las pruebas SMS. Consume cuota de Twilio.',pausar:'Se cancelarán los SMS pendientes. Uno que ya esté en curso podría completarse. Las llamadas y notificaciones mantendrán sus propios controles.'}
  return <Panel title="SMS automáticos" description="Demostración Trial vinculada a las reglas del IGP." action={<Badge tone={data?.habilitadas?'warning':'neutral'}>{data?.habilitadas?'Habilitados':'Pausados'}</Badge>}>
    <p className="information-note"><strong>Contenido de demostración.</strong> Se enviará el recordatorio de cita de Twilio, sin los datos del sismo. Esta opción prueba el disparo automático; el SMS no sirve como alerta sísmica.</p>
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="export-success" role="status">{message}</p>}
    {!data&&!error&&<p role="status">Consultando configuración SMS…</p>}
    {data&&<>
      <div className="alerts-phone-summary"><div><span className="alerts-label">Teléfono autorizado para SMS</span><h3>{data.telefono.activo?`••• ••• ${data.telefono.ultimos}`:'Sin teléfono autorizado'}</h3><p>{data.telefono.activo?'Autorización de demostración activa':'Completa una prueba SMS y consulta su entrega.'}</p></div><Button variant="primary" disabled={busy||(!data.habilitadas&&(!data.configurada||!data.telefono.activo))} onClick={()=>setPending(data.habilitadas?'pausar':'activar')}>{data.habilitadas?'Pausar SMS automáticos':'Habilitar SMS automáticos'}</Button></div>
      {!data.telefono.activo&&<label className="field"><span>Tu teléfono para SMS</span><select value={target} disabled={busy} onChange={event=>setTarget(event.target.value)}><option value="">Selecciona tu teléfono</option>{targets.map(row=><option key={row.id} value={row.id}>{row.etiqueta}</option>)}</select></label>}
      <div className="push-actions alerts-secondary-actions">{data.telefono.activo?<Button disabled={busy} onClick={()=>setPending('retirar')}>Retirar autorización SMS</Button>:<Button disabled={busy||!data.configurada||!targets.some(row=>row.id===target)} onClick={()=>setPending('autorizar')}>Autorizar mi teléfono para SMS</Button>}<Button icon="refresh" disabled={busy} onClick={()=>setVersion(value=>value+1)}>Actualizar configuración SMS</Button></div>
      {data.habilitadas&&!data.cuenta_coincide&&<p className="inline-error">La cuenta de Twilio cambió. Pausa y vuelve a configurar los SMS.</p>}
      <details className="alerts-help"><summary>Reglas y límites SMS</summary><p>Selecciona SMS en una regla y añade tu cuenta como destinatario. Solo se admiten administradores con autorización SMS. Se procesará como máximo un SMS por sincronización, aproximadamente cada diez minutos; puede haber retrasos. Se excluyen eventos anteriores a la activación y reportes de más de dos horas.</p><p>Las pruebas manuales y los SMS automáticos comparten el mismo límite. Se cuentan también las solicitudes fallidas; no hay reintentos automáticos.</p></details>
    </>}
    <ConfirmDialog open={!!pending} title={pending==='autorizar'?'¿Autorizar SMS de demostración?':pending==='retirar'?'¿Retirar la autorización SMS?':pending==='activar'?'¿Habilitar SMS automáticos de demostración?':'¿Pausar SMS automáticos?'} description={pending?descriptions[pending]:''} confirmLabel="Sí, confirmar SMS" busy={busy} onCancel={()=>{if(!busy)setPending(null)}} onConfirm={()=>void save()}/>
  </Panel>
}
