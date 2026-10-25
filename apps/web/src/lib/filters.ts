import type { EventoSismico } from '../services/api'
export type Filters = { q: string; magnitude: string; since: string; until: string;
  minMagnitude?: string; maxMagnitude?: string; minDepth?: string; maxDepth?: string;
  region?: string; source?: string; latitude?: string; longitude?: string; radius?: string; polygon?: string }
const extras = {minMagnitude:'mag_min',maxMagnitude:'mag_max',minDepth:'prof_min',maxDepth:'prof_max',region:'region',source:'fuente',latitude:'lat',longitude:'lon',radius:'radio',polygon:'poligono'} as const
export const numeric = (value?: string) => value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null
export function polygonPoints(value?: string): [number,number][] {
  try { const p: unknown=JSON.parse(value || '[]'); return Array.isArray(p) && p.length>=3 && p.length<=50 && p.every(v=>Array.isArray(v)&&v.length===2&&v.every(Number.isFinite)&&Math.abs(v[0])<=90&&Math.abs(v[1])<=180) ? p as [number,number][] : [] } catch {return []}
}
export function filterError(f: Filters): string {
  if(f.source&&f.source!=='igp')return 'La fuente seleccionada no está disponible.'
  if(invalidDateRange(f)) return 'La fecha Hasta debe ser igual o posterior a Desde.'
  for(const [a,b,min,max,label] of [[f.minMagnitude,f.maxMagnitude,0,10,'magnitud'],[f.minDepth,f.maxDepth,0,1000,'profundidad']] as const){
    if([a,b].some(v=>v && (numeric(v)===null||Number(v)<min||Number(v)>max))) return `Revisa los límites de ${label} (${min}–${max}).`
    if(numeric(a)!==null&&numeric(b)!==null&&Number(a)>Number(b)) return `El mínimo de ${label} no puede superar al máximo.`
  }
  if(f.latitude||f.longitude||f.radius){
    if(numeric(f.latitude)===null||numeric(f.longitude)===null||numeric(f.radius)===null||Math.abs(Number(f.latitude))>90||Math.abs(Number(f.longitude))>180||Number(f.radius)<=0||Number(f.radius)>2000) return 'Completa latitud, longitud y radio (mayor que 0 y hasta 2000 km).'
  }
  if(f.polygon&&!polygonPoints(f.polygon).length) return 'El polígono debe tener entre 3 y 50 coordenadas válidas [latitud, longitud].'
  return ''
}
export function insidePolygon(lat:number,lon:number,points:[number,number][]) {
  let inside=false
  for(let i=0,j=points.length-1;i<points.length;j=i++){
    const [y1,x1]=points[j], [y2,x2]=points[i]
    if(Math.abs((lon-x1)*(y2-y1)-(lat-y1)*(x2-x1))<1e-9&&lon>=Math.min(x1,x2)&&lon<=Math.max(x1,x2)&&lat>=Math.min(y1,y2)&&lat<=Math.max(y1,y2))return true
    if((y1>lat)!==(y2>lat)&&lon<(x2-x1)*(lat-y1)/(y2-y1)+x1)inside=!inside
  }
  return inside
}
export function matchesEvent(event:EventoSismico,f:Filters) {
  if(filterError(f))return false
  if(!`${event.lugar} ${event.id_externo} ${event.id}`.toLocaleLowerCase('es').includes(f.q.trim().toLocaleLowerCase('es')))return false
  if(f.since&&event.ocurrido_en.slice(0,10)<f.since||f.until&&event.ocurrido_en.slice(0,10)>f.until)return false
  if(f.region&&(event.region||'Sin región')!==f.region||f.source&&f.source!=='igp')return false
  const m=event.magnitud
  if(f.magnitude!=='todos'&&(m===null||!(f.magnitude==='menor'?m<4:f.magnitude==='medio'?m>=4&&m<6:m>=6)))return false
  if((numeric(f.minMagnitude)!==null||numeric(f.maxMagnitude)!==null)&&(m===null||numeric(f.minMagnitude)!==null&&m<Number(f.minMagnitude)||numeric(f.maxMagnitude)!==null&&m>Number(f.maxMagnitude)))return false
  if(numeric(f.minDepth)!==null&&event.profundidad<Number(f.minDepth)||numeric(f.maxDepth)!==null&&event.profundidad>Number(f.maxDepth))return false
  if(f.radius){
    const rad=Math.PI/180, dlat=(event.latitud-Number(f.latitude))*rad,dlon=(event.longitud-Number(f.longitude))*rad
    const a=Math.sin(dlat/2)**2+Math.cos(event.latitud*rad)*Math.cos(Number(f.latitude)*rad)*Math.sin(dlon/2)**2
    if(6371*2*Math.asin(Math.sqrt(Math.min(1,a)))>Number(f.radius)+1e-8)return false
  }
  return !f.polygon||insidePolygon(event.latitud,event.longitud,polygonPoints(f.polygon))
}

export const invalidDateRange = (filters: Filters) => Boolean(filters.since && filters.until && filters.since > filters.until)
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const magnitude = params.get('magnitud') || 'todos'
  const since = params.get('desde') || ''
  const until = params.get('hasta') || ''
  return {
    q: (params.get('q') || '').slice(0, 200),
    magnitude: ['todos', 'menor', 'medio', 'mayor'].includes(magnitude) ? magnitude : 'todos',
    since: validDate(since) ? since : '',
    until: validDate(until) ? until : '',
    ...Object.fromEntries(Object.entries(extras).flatMap(([key,param])=>{const v=params.get(param);return v ? [[key,v.slice(0,key==='polygon'?3000:120)]]:[]})),
  }
}

export function filterSearch(filters: Filters) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.magnitude !== 'todos') params.set('magnitud', filters.magnitude)
  if (filters.since) params.set('desde', filters.since)
  if (filters.until) params.set('hasta', filters.until)
  for(const [key,param] of Object.entries(extras)) {const v=filters[key as keyof typeof extras];if(v)params.set(param,v)}
  return params.size ? `?${params.toString()}` : ''
}
