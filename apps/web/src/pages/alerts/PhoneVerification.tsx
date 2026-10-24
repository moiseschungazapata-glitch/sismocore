import { useState, type FormEvent } from 'react'
import { Button, ConfirmDialog, Dialog } from '../../components/ui'
import { checkPhoneVerification, startPhoneVerification, type VerificationResult } from '../../services/voice'

export default function PhoneVerification({configured,onVerified}:{configured:boolean;onVerified:()=>void}){
  const [phone,setPhone]=useState('')
  const [consent,setConsent]=useState(false)
  const [confirm,setConfirm]=useState(false)
  const [result,setResult]=useState<VerificationResult|null>(null)
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  const [message,setMessage]=useState('')
  function review(event:FormEvent){event.preventDefault();if(/^[9][0-9]{8}$/.test(phone)&&consent)setConfirm(true)}
  async function start(){
    if(busy)return
    setBusy(true);setError('');setMessage('')
    try{
      const value=await startPhoneVerification('+51'+phone)
      if(value.verificado){setMessage('El número ya está verificado en Twilio. Puedes seleccionarlo en las llamadas de prueba.');onVerified()}
      else setResult(value)
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo confirmar la verificación. No repitas la llamada de inmediato.')}
    finally{setBusy(false);setConfirm(false)}
  }
  async function check(){
    if(busy||!result?.id)return
    setBusy(true);setError('');setMessage('')
    try{
      const value=await checkPhoneVerification(result.id)
      if(value.verificado){setResult(null);setMessage('Teléfono verificado. Selecciónalo en Probar una llamada y completa una prueba antes de autorizar llamadas automáticas.');setPhone('');setConsent(false);onVerified()}
      else setMessage('Twilio todavía no confirma la verificación. Introduce el código durante la llamada y vuelve a comprobar.')
    }catch(failure){setError(failure instanceof Error?failure.message:'No se pudo consultar la verificación.')}
    finally{setBusy(false)}
  }
  return <details className="alerts-tools"><summary>Agregar y verificar teléfono<span>Registra un celular del Perú para llamadas</span></summary>
    <form className="panel push-rule-form" onSubmit={review}>
      <p className="push-caption">Twilio llamará al número y te pedirá introducir un código con el teclado del teléfono. La llamada es en inglés. La cuenta Trial debe admitir la verificación por API.</p>
      <label className="field"><span>Celular del Perú (+51)</span><input type="tel" inputMode="numeric" autoComplete="tel-national" pattern="9[0-9]{8}" minLength={9} maxLength={9} placeholder="9 dígitos, comienza con 9" required value={phone} disabled={busy} onChange={event=>setPhone(event.target.value.replace(/[^0-9]/g,''))}/></label>
      <label className="push-check"><input type="checkbox" required checked={consent} disabled={busy} onChange={event=>setConsent(event.target.checked)}/>Tengo acceso al teléfono y autorización para verificarlo.</label>
      {error&&!result&&<p className="inline-error" role="alert">{error}</p>}{message&&!result&&<p className="export-success" role="status">{message}</p>}
      <div className="push-actions"><Button type="submit" variant="primary" disabled={busy||!configured||!consent||!/^9[0-9]{8}$/.test(phone)}>Verificar número</Button></div>
      <p className="push-caption">Comparte el límite de cinco intentos diarios y cincuenta en total con las llamadas. Espera un minuto entre solicitudes. Verificar el número no activa las llamadas automáticas.</p>
    </form>
    <ConfirmDialog open={confirm} title="¿Iniciar la verificación del teléfono?" description={`Twilio realizará una llamada real al celular terminado en ${phone.slice(-4)}. SISMOCORE mostrará el código para introducirlo en el teclado durante la llamada. Puede consumir cuota Trial. Si el resultado es incierto, no se reintentará automáticamente.`} confirmLabel="Sí, verificar por llamada" busy={busy} onCancel={()=>{if(!busy)setConfirm(false)}} onConfirm={()=>void start()}/>
    <Dialog open={!!result} title="Introduce este código durante la llamada" eyebrow="VERIFICAR TELÉFONO" description={`Twilio está verificando el celular terminado en ${result?.ultimos||''}. Contesta e introduce los seis dígitos con el teclado de tu teléfono.`} busy={busy} onClose={()=>{if(!busy){setResult(null);setError('');setMessage('')}}}>
      <output className="voice-verification-code" aria-label="Código de verificación">{result?.codigo}</output>
      {error&&<p className="inline-error" role="alert">{error}</p>}{message&&<p role="status">{message}</p>}
      <div className="push-actions"><Button variant="primary" loading={busy} onClick={()=>void check()}>Comprobar verificación</Button></div>
      <p className="push-caption">Comprobar consulta el estado; no inicia otra llamada. No cierres esta ventana hasta introducir el código. Si la cierras, puedes actualizar la lista de llamadas para comprobar si el número ya está disponible.</p>
    </Dialog>
  </details>
}
