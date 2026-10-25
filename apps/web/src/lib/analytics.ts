import type { EventoSismico } from '../services/api'
export type Grouping='dia'|'semana'|'mes'
export function timeBuckets(events:EventoSismico[],cutoff:string,days:number,group:Grouping='dia',since='',until='') {
  const end=Math.min(Date.parse(cutoff),until?Date.parse(until+'T23:59:59.999Z'):Infinity)
  const start=Math.max(Date.parse(cutoff)-days*86400000,since?Date.parse(since+'T00:00:00Z'):-Infinity)
  const key=(value:number)=>{const d=new Date(value);d.setUTCHours(0,0,0,0);if(group==='semana')d.setUTCDate(d.getUTCDate()-(d.getUTCDay()+6)%7);if(group==='mes')d.setUTCDate(1);return d.toISOString().slice(0,10)}
  const buckets=new Map<string,number>()
  for(let t=start;t<=end;t+=86400000)buckets.set(key(t),0)
  if(start<=end)buckets.set(key(end),0)
  events.forEach(e=>{const t=Date.parse(e.ocurrido_en);if(t>=start&&t<=end){const k=key(t);buckets.set(k,(buckets.get(k)||0)+1)}})
  return [...buckets].sort(([a],[b])=>a.localeCompare(b)).map(([date,value])=>({date,label:group==='mes'?date.slice(0,7):date.slice(8,10)+'/'+date.slice(5,7),value}))
}
export function depthBuckets(events:EventoSismico[],step:number) {
 const bins=new Map<number,number>()
 events.forEach(e=>{if(Number.isFinite(e.profundidad)){const low=Math.floor(e.profundidad/step)*step;bins.set(low,(bins.get(low)||0)+1)}})
 const max=events.length?Math.max(...events.map(e=>e.profundidad)):0
 return Array.from({length:Math.floor(max/step)+1},(_,i)=>({label:`${i*step} a < ${(i+1)*step} km`,value:bins.get(i*step)||0}))
}
