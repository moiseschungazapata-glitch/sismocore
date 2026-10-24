import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, Panel } from '../../components/ui'
import { fecha } from '../../lib/format'
import { currentPushDevice, deactivatePush, enablePush, notificationStatus, pushSupport, sendPushTest, type PushDevice, type PushStatus } from '../../services/notifications'
import './alerts.css'
import { Rules, AlertHistory } from './Rules'
import VoiceTrial from './VoiceTrial'
import SmsTrial from './SmsTrial'
import AutomaticPush from './AutomaticPush'
import { Icon } from '../../components/Icon'

export default function Alerts({ userId,manageRules=false,manageCalls=false }: { userId:string;manageRules?:boolean;manageCalls?:boolean }) {
  const [section,setSection]=useState<'reglas'|'canales'|'historial'>(manageRules?'reglas':'canales')
  const [channel,setChannel]=useState<'push'|'voz'|'sms'>('push')
  const activeSection=section==='reglas'&&!manageRules?'canales':section
  const [status,setStatus] = useState<PushStatus | null>(null)
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')
  const [busy,setBusy] = useState(false)
  const [revision,setRevision] = useState(0)
  const [permission,setPermission] = useState('Notification' in window ? Notification.permission : 'denied')
  const [confirmation,setConfirmation] = useState<{ device:PushDevice; test:boolean } | null>(null)
  const unsupported = pushSupport()
  const current = currentPushDevice(userId)
  useEffect(() => {
    const controller = new AbortController()
    void notificationStatus(controller.signal).then(value => { if (!controller.signal.aborted) setStatus(value) }).catch(failure => {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudieron consultar los dispositivos.')
    })
    return () => controller.abort()
  },[revision])
  useEffect(() => {
    const update = () => setPermission('Notification' in window ? Notification.permission : 'denied')
    window.addEventListener('focus',update)
    document.addEventListener('visibilitychange',update)
    return () => { window.removeEventListener('focus',update); document.removeEventListener('visibilitychange',update) }
  },[])
  async function activate() {
    setBusy(true); setError(''); setMessage('')
    try {
      await enablePush(userId)
      setMessage('Este navegador está registrado. Ya puedes comprobar la recepción con una prueba.')
      window.dispatchEvent(new Event('sismocore:push-settings-changed'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo activar este navegador.') }
    finally { setBusy(false); setPermission('Notification' in window ? Notification.permission : 'denied'); setRevision(value => value+1) }
  }
  async function confirm() {
    if (!confirmation || busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (confirmation.test) setMessage((await sendPushTest(confirmation.device.id)).message)
      else {
        await deactivatePush(confirmation.device.id,userId)
        setMessage('Dispositivo desactivado para tu cuenta.')
        window.dispatchEvent(new Event('sismocore:push-settings-changed'))
      }
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo completar la operación.') }
    finally { setBusy(false); setConfirmation(null); setRevision(value => value+1) }
  }
  const registered = status?.dispositivos.some(device => device.id === current)
  return <div className="push-center">
    <nav className="alerts-nav" aria-label="Secciones de alertas">
      {manageRules&&<button type="button" aria-pressed={activeSection==='reglas'} onClick={()=>setSection('reglas')}><Icon name="filter" size={17}/>Reglas</button>}
      <button type="button" aria-pressed={activeSection==='canales'} onClick={()=>setSection('canales')}><Icon name="source" size={17}/>Canales</button>
      <button type="button" aria-pressed={activeSection==='historial'} onClick={()=>setSection('historial')}><Icon name="clock" size={17}/>Historial</button>
    </nav>
    {activeSection==='reglas'&&manageRules&&<Rules userId={userId}/>}
    {activeSection==='historial'&&<AlertHistory manage={manageRules}/>}
    {activeSection==='canales'&&<div className="alerts-channel-layout">
      {manageCalls&&<nav className="alerts-channel-nav" aria-label="Canal de entrega">
        <button type="button" aria-label="Notificaciones Navegadores y dispositivos" aria-pressed={channel==='push'} onClick={()=>setChannel('push')}><Icon name="alert" size={18}/><span>Notificaciones<small>Navegadores y dispositivos</small></span></button>
        <button type="button" aria-label="Llamadas Teléfono autorizado" aria-pressed={channel==='voz'} onClick={()=>setChannel('voz')}><Icon name="wave" size={18}/><span>Llamadas<small>Teléfono autorizado</small></span></button>
        <button type="button" aria-label="SMS Mensajes de prueba" aria-pressed={channel==='sms'} onClick={()=>setChannel('sms')}><Icon name="mail" size={18}/><span>SMS<small>Mensajes de prueba</small></span></button>
      </nav>}
      {channel==='voz'&&manageCalls?<VoiceTrial/>:channel==='sms'&&manageCalls?<SmsTrial/>:<>
        <AutomaticPush status={status} onChanged={()=>setRevision(value=>value+1)}/>
        <Panel title="Tus dispositivos" description="Administra dónde recibes las notificaciones." action={<Button icon="refresh" disabled={busy} onClick={()=>{setError('');setRevision(value=>value+1)}}>Actualizar lista</Button>}>
          <div className="alerts-browser">
            <span className="alerts-channel-icon"><Icon name="alert" size={21}/></span>
            <div className="alerts-browser-copy"><h3>Este navegador <Badge tone={registered&&permission==='granted'?'success':'neutral'}>{registered&&permission==='granted'?'Activado':'Sin activar'}</Badge></h3><p>{registered?'Las notificaciones están vinculadas a tu cuenta.':'Actívalo para recibir avisos en este dispositivo.'}</p></div>
            <Button variant={registered?'secondary':'primary'} icon="alert" loading={busy} disabled={!!unsupported} onClick={()=>void activate()}>{registered?'Renovar activación':'Activar notificaciones'}</Button>
          </div>
          {unsupported&&<p className="inline-error">{unsupported}</p>}
          {!unsupported&&permission==='denied'&&<p className="information-note">Las notificaciones están bloqueadas. En los permisos del sitio de Chrome, permite Notificaciones.</p>}
          {status&&!status.configurada&&<p className="information-note"><strong>Envío pendiente de configuración.</strong> Las pruebas se habilitarán al configurar Firebase en el servidor.</p>}
          {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="export-success" role="status">{message}</p>}
          {!status?<p role="status">Consultando dispositivos…</p>:!status.dispositivos.length?<div className="alerts-empty"><Icon name="alert" size={24}/><p>Aún no tienes dispositivos activados.</p><span>Activa este navegador para comenzar.</span></div>:<ul className="push-devices">{status.dispositivos.map(device=><li key={device.id}>
            <div className="push-device-details"><h3>{device.etiqueta} {device.id===current&&<Badge tone="info">Este navegador</Badge>}</h3><p>{device.ultima_prueba_en?`Última prueba: ${fecha(device.ultima_prueba_en)} · ${device.ultima_prueba_estado==='aceptada'?'Aceptada':device.ultima_prueba_estado==='fallida'?'Sin confirmación':'En proceso'}`:`Registrado: ${fecha(device.registrado_en)}`}</p></div>
            <div className="push-actions"><Button disabled={busy||!status.configurada||(device.id===current&&permission!=='granted')} onClick={()=>setConfirmation({device,test:true})}>Enviar prueba</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirmation({device,test:false})}>Desactivar</Button></div>
          </li>)}</ul>}
          <details className="alerts-help"><summary>Ayuda con las notificaciones</summary><p>En Android, utiliza Chrome y permite las notificaciones del sitio. Para comprobarlas, deja Chrome en segundo plano y revisa el panel del celular. Se permite una prueba por minuto; la aceptación de Firebase no confirma la entrega. Al cerrar sesión, se desactiva este navegador.</p></details>
        </Panel>
      </>}
    </div>}
    <p className="alerts-footnote"><Icon name="info" size={15}/>Los avisos corresponden a sismos ya reportados por el IGP; no anticipan terremotos.</p>
    <ConfirmDialog open={!!confirmation} title={confirmation?.test?'¿Enviar una notificación de prueba?':'¿Desactivar este dispositivo?'} description={confirmation?.test?`Se enviará únicamente a «${confirmation.device.etiqueta}» y estará identificada como PRUEBA. Revisa la notificación en ese dispositivo. No representa una alerta sísmica.`:'Este navegador dejará de recibir notificaciones para tu cuenta. Puedes volver a activarlo cuando quieras.'} confirmLabel={confirmation?.test?'Enviar prueba':'Desactivar'} busy={busy} onCancel={()=>{if(!busy)setConfirmation(null)}} onConfirm={()=>void confirm()}/>
  </div>
}
