import { useEffect, useState } from 'react'
import { Badge, Button, ConfirmDialog, Panel } from '../../components/ui'
import { fecha } from '../../lib/format'
import { currentPushDevice, deactivatePush, enablePush, notificationStatus, pushSupport, sendPushTest, type PushDevice, type PushStatus } from '../../services/notifications'
import './alerts.css'

export default function Alerts({ userId }: { userId:string }) {
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
    <Panel title="Notificaciones en este navegador" description="Recibe avisos de SISMOCORE en tus dispositivos, con tu autorización." action={<Badge tone={registered && permission === 'granted' ? 'success' : 'neutral'}>{registered && permission === 'granted' ? 'Navegador activado' : 'Sin activar'}</Badge>}>
      <div className="push-intro"><div><h3>Activa y comprueba la conexión</h3><p>En Android, abre SISMOCORE en Chrome y permite las notificaciones. Para la prueba, deja Chrome en segundo plano y revisa el panel de notificaciones del celular.</p></div><Button variant="primary" icon="alert" loading={busy} disabled={!!unsupported} onClick={() => void activate()}>{registered ? 'Renovar activación' : 'Activar notificaciones'}</Button></div>
      {unsupported && <p className="inline-error">{unsupported}</p>}
      {!unsupported && permission === 'denied' && <p className="information-note">Las notificaciones están bloqueadas. En Chrome, abre la información del sitio → Permisos → Notificaciones y permite los avisos.</p>}
      {status && !status.configurada && <div className="information-note"><p><strong>Envío pendiente de configuración.</strong> Puedes registrar este navegador; las pruebas estarán disponibles al completar la configuración de Firebase en el servidor.</p></div>}
      {error && <p className="inline-error" role="alert">{error}</p>}
      {message && <p className="export-success" role="status">{message}</p>}
    </Panel>
    <Panel title="Tus dispositivos" description="Solo se muestran los navegadores registrados en tu cuenta." action={<Button icon="refresh" disabled={busy} onClick={() => { setError(''); setRevision(value => value+1) }}>Actualizar lista</Button>}>
      {!status ? <p role="status">Consultando dispositivos…</p> : !status.dispositivos.length ? <p>Aún no tienes dispositivos activados. Registra este navegador para comenzar.</p> : <ul className="push-devices">{status.dispositivos.map(device => <li key={device.id}>
        <div className="push-device-details"><h3>{device.etiqueta}</h3>{device.id === current && <Badge tone="info">Este navegador</Badge>}<p>Activado: {fecha(device.registrado_en)} · Perú</p>{device.ultima_prueba_en && <p>Última prueba: {fecha(device.ultima_prueba_en)} · {device.ultima_prueba_estado === 'aceptada' ? 'Aceptada por Firebase' : device.ultima_prueba_estado === 'fallida' ? 'No se confirmó el envío' : 'Solicitud en proceso'}</p>}</div>
        <div className="push-actions">{device.id === current && <Button disabled={busy || !status.configurada || permission !== 'granted'} onClick={() => setConfirmation({ device,test:true })}>Enviar prueba</Button>}<Button variant="ghost" disabled={busy} onClick={() => setConfirmation({ device,test:false })}>Desactivar</Button></div>
      </li>)}</ul>}
      <p className="push-caption">Una prueba por minuto. Que Firebase acepte el mensaje no confirma su entrega; comprueba que aparezca en tu celular. Al cerrar sesión se desactiva este navegador.</p>
    </Panel>
    <Panel title="Avisos automáticos" description="Siguiente paso: definir las reglas de notificación."><p>Actualmente solo se envían pruebas solicitadas por ti. Los reportes del IGP describen eventos ya ocurridos; este servicio no predice sismos ni garantiza un aviso antes de sentirlos.</p></Panel>
    <ConfirmDialog open={!!confirmation} title={confirmation?.test ? '¿Enviar una notificación de prueba?' : '¿Desactivar este dispositivo?'} description={confirmation?.test ? 'Se enviará únicamente a este navegador y estará identificada como PRUEBA. No representa una alerta sísmica.' : 'Este navegador dejará de recibir notificaciones para tu cuenta. Puedes volver a activarlo cuando quieras.'} confirmLabel={confirmation?.test ? 'Enviar prueba' : 'Desactivar'} busy={busy} onCancel={() => { if (!busy) setConfirmation(null) }} onConfirm={() => void confirm()} />
  </div>
}
