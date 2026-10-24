import { protectedRequest } from './auth'
import type { VoiceTrial } from './voice'
export type SmsTrialSettings=Omit<VoiceTrial,'automaticas'>
export const loadSmsTrial=(signal?:AbortSignal)=>protectedRequest<SmsTrialSettings>('sms/pruebas',undefined,undefined,signal)
export const sendSmsTrial=(destino_id:string)=>protectedRequest<{message:string}>('sms/pruebas',{destino_id,confirmado:true})
export const refreshSmsTrial=(id:string)=>protectedRequest<{estado:string}>(`sms/pruebas/${id}/actualizar`,{})
export type AutomaticSmsSettings={configurada:boolean;habilitadas:boolean;cuenta_coincide:boolean;telefono:{activo:boolean;ultimos:string|null;autorizado_en:string|null}}
export const loadAutomaticSms=()=>protectedRequest<AutomaticSmsSettings>('sms/automaticos')
export const authorizeSmsPhone=(destino_id:string)=>protectedRequest<{message:string}>('sms/telefono',{destino_id,confirmado:true,demostracion_trial:true})
export const revokeSmsPhone=()=>protectedRequest<{message:string}>('sms/telefono/desactivar',{})
export const switchAutomaticSms=(activa:boolean)=>protectedRequest<{message:string}>('sms/automaticos',{activa,confirmado:true,demostracion_trial:true})
