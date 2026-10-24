import { protectedRequest } from './auth'
export type VoiceTrial={configurada:boolean;automaticas:false;destinatarios:{id:string;etiqueta:string}[];
  limites:{usadas_hoy:number;usadas_total:number;limite_diario:number;limite_total:number;espera_segundos:number}|null;
  historial:{id:string;fecha:string;ultimos:string;estado:string}[]}
export const loadVoiceTrial=(signal?:AbortSignal)=>protectedRequest<VoiceTrial>('voz/pruebas',undefined,undefined,signal)
export const startVoiceTrial=(destino_id:string)=>protectedRequest<{id:string;estado:string;message:string}>('voz/pruebas',{destino_id,confirmado:true})
export const refreshVoiceTrial=(id:string)=>protectedRequest<{estado:string}>(`voz/pruebas/${id}/actualizar`,{})
export type AutomaticVoiceSettings={configurada:boolean;habilitadas:boolean;cuenta_coincide:boolean;telefono:{activo:boolean;ultimos:string|null;autorizado_en:string|null}}
export const loadAutomaticVoice=()=>protectedRequest<AutomaticVoiceSettings>('voz/automaticas')
export const authorizeVoicePhone=(destino_id:string)=>protectedRequest<{message:string}>('voz/telefono',{destino_id,confirmado:true})
export const revokeVoicePhone=()=>protectedRequest<{message:string}>('voz/telefono/desactivar',{})
export const switchAutomaticVoice=(activa:boolean)=>protectedRequest<{message:string}>('voz/automaticas',{activa,confirmado:true})
export type VerificationResult={verificado:boolean;id?:string;codigo?:string;ultimos:string}
export const startPhoneVerification=(telefono:string)=>protectedRequest<VerificationResult>('voz/verificaciones',{telefono,confirmado:true,consentimiento:true})
export const checkPhoneVerification=(id:string)=>protectedRequest<{verificado:boolean;ultimos:string}>(`voz/verificaciones/${id}`)
