import { useState } from 'react'
import { Badge, Button, ConfirmDialog, Panel } from '../../components/ui'
import { switchAutomaticPush, type PushStatus } from '../../services/notifications'

export default function AutomaticPush({status,onChanged}:{status:PushStatus|null;onChanged:()=>void}){
  const [confirm,setConfirm]=useState(false)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  const enabled=status?.automaticas_habilitadas??true
  async function save(){
    if(!status||busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const result=await switchAutomaticPush(!enabled)
      setMessage(result.message);onChanged();window.dispatchEvent(new Event('sismocore:push-settings-changed'))
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo cambiar el estado de las notificaciones.')}
    finally{setBusy(false);setConfirm(false)}
  }
  return <Panel title="Notificaciones automáticas" description="Avisos de tus reglas en los dispositivos activados." action={<Badge tone={!status?'neutral':enabled?'success':'neutral'}>{!status?'Consultando…':enabled?'Habilitadas':'Pausadas'}</Badge>}>
    <div className="alerts-phone-summary"><div><span className="alerts-label">Control general de notificaciones</span><h3>{enabled?'Avisos por notificación':'Envíos en pausa'}</h3><p>{!status?'Consultando configuración…':enabled?(status.reglas_activas?'Tienes reglas activas para recibir avisos.':'Tu cuenta aún no tiene una regla activa de notificación.'):'Las pruebas manuales siguen disponibles.'}</p></div>
      {status?.puede_configurar_automaticas&&<Button variant="primary" disabled={busy||(!enabled&&!status.configurada)} onClick={()=>setConfirm(true)}>{enabled?'Pausar notificaciones automáticas':'Habilitar notificaciones automáticas'}</Button>}
    </div>
    {!status?.configurada&&status&&<p className="information-note">Falta completar la configuración de Firebase en este servidor.</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p className="export-success" role="status">{message}</p>}
    <details className="alerts-help"><summary>Cómo funcionan los avisos automáticos</summary><p>Requieren una regla activa con el canal Notificación o Ambos y un dispositivo activado del destinatario. Se procesan durante la sincronización programada, aproximadamente cada diez minutos; puede haber retrasos.</p><p>El control general afecta a todos los usuarios y solo lo modifica administración. Al reactivarlo se consideran eventos nuevos, sin recuperar el catálogo histórico. Las llamadas tienen su propio control.</p></details>
    <ConfirmDialog open={confirm} title={enabled?'¿Pausar notificaciones automáticas?':'¿Habilitar notificaciones automáticas?'} description={enabled?'Se pausarán las notificaciones automáticas para todos los usuarios y se cancelarán los envíos pendientes. Alguno que ya esté en curso podría completarse. Las pruebas manuales y las llamadas conservan sus propios controles.':'Se enviarán notificaciones a los dispositivos activados cuando un evento nuevo coincida con una regla activa. Se aplica a todos los usuarios; no se enviará el catálogo histórico.'} confirmLabel={enabled?'Sí, pausar notificaciones':'Sí, habilitar notificaciones'} busy={busy} onCancel={()=>{if(!busy)setConfirm(false)}} onConfirm={()=>void save()}/>
  </Panel>
}
