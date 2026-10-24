import { protectedRequest } from './auth'
export type Zone={ latitud:number; longitud:number; radio_km:number }
export type Rule={ id:string; nombre:string; version:number; magnitud_minima:number; zona:Partial<Zone>; destinatarios:string[]; activa:boolean; vigente_desde:string; actualizado_en:string }
export const ruleZone=(rule:Rule):Zone | null=>typeof rule.zona.latitud==='number'&&typeof rule.zona.longitud==='number'&&typeof rule.zona.radio_km==='number'?rule.zona as Zone:null
export type RuleInput={ nombre:string; magnitud_minima:number; zona:Zone | null; destinatarios:string[]; activa:boolean; version?:number }
export type Recipient={id:string; nombre_completo:string; rol:string}
export type Delivery={id:string; estado:string; creado_en:string; ultimo_intento_en:string | null; error_codigo:string | null; intentos:number; usuario?:{nombre_completo:string}|null;dispositivo?:{etiqueta:string}|null; alerta:{titulo:string;mensaje:string;url_fuente:string;contexto:{regla?:string}}}
export const listRules=(signal?:AbortSignal)=>protectedRequest<{reglas:Rule[];destinatarios:Recipient[]}>('alertas/reglas',undefined,undefined,signal)
export const saveRule=(input:RuleInput,id?:string)=>protectedRequest<{regla:Rule}>(`alertas/reglas${id?'/'+id:''}`,input,id?'PATCH':'POST')
export const deliveryHistory=(signal?:AbortSignal,all=false)=>protectedRequest<{entregas:Delivery[]}>(`alertas/historial?alcance=${all?'todas':'propias'}`,undefined,undefined,signal)
