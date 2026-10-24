import { protectedRequest } from './auth'
export type VoiceTrial={configurada:boolean;automaticas:false;destinatarios:{id:string;etiqueta:string}[];
  limites:{usadas_hoy:number;usadas_total:number;limite_diario:number;limite_total:number;espera_segundos:number}|null;
  historial:{id:string;fecha:string;ultimos:string;estado:string}[]}
export const loadVoiceTrial=(signal?:AbortSignal)=>protectedRequest<VoiceTrial>('voz/pruebas',undefined,undefined,signal)
export const startVoiceTrial=(destino_id:string)=>protectedRequest<{id:string;estado:string;message:string}>('voz/pruebas',{destino_id,confirmado:true})
export const refreshVoiceTrial=(id:string)=>protectedRequest<{estado:string}>(`voz/pruebas/${id}/actualizar`,{})
