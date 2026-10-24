import { protectedRequest } from './auth'
import type { VoiceTrial } from './voice'
export type SmsTrialSettings=Omit<VoiceTrial,'automaticas'>
export const loadSmsTrial=(signal?:AbortSignal)=>protectedRequest<SmsTrialSettings>('sms/pruebas',undefined,undefined,signal)
export const sendSmsTrial=(destino_id:string)=>protectedRequest<{message:string}>('sms/pruebas',{destino_id,confirmado:true})
export const refreshSmsTrial=(id:string)=>protectedRequest<{estado:string}>(`sms/pruebas/${id}/actualizar`,{})
