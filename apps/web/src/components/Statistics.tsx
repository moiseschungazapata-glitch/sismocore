import { useEffect, useRef, useState } from 'react'
import type { EventoSismico } from '../services/api'
import { Button, Metric, Panel } from './ui'
import { number, fecha } from '../lib/format'
import { timeBuckets, depthBuckets, type Grouping } from '../lib/analytics'
import type { Filters } from '../lib/filters'

export function Statistics({ events, cutoff, days = 30, filters, compact=false, onExport }: { events: EventoSismico[]; cutoff: string; days?: number; filters?:Filters; compact?:boolean; onExport?:()=>void }) {
  const [group,setGroup]=useState<Grouping>('dia')
  const [depthStep,setDepthStep]=useState(50)
  const [x,setX]=useState<'profundidad'|'magnitud'>('profundidad')
  const [y,setY]=useState<'profundidad'|'magnitud'>('magnitud')
  const magnitudes=events.flatMap(e=>e.magnitud===null?[]:[e.magnitud])
  const averageDepth=events.length?events.reduce((s,e)=>s+e.profundidad,0)/events.length:null
  const ranges=[{label:'Menor de 4',value:magnitudes.filter(m=>m<4).length,color:'#60c5d5'},{label:'4 a menos de 6',value:magnitudes.filter(m=>m>=4&&m<6).length,color:'#7aa5eb'},{label:'6 o más',value:magnitudes.filter(m=>m>=6).length,color:'#b39cde'}]
  const dailyCounts=timeBuckets(events,cutoff,days,group,filters?.since,filters?.until)
  const regions=new Map<string,number>()
  events.forEach(e=>regions.set(e.region||'Sin región',(regions.get(e.region||'Sin región')||0)+1))
  const regionData=[...regions].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])).map(([label,value])=>({label,value}))
  const filterContext=filters?[filters.q?`búsqueda: ${filters.q}`:'',filters.region?`región: ${filters.region}`:'',filters.magnitude!=='todos'?`rango: ${filters.magnitude}`:'',filters.minMagnitude?`M ≥ ${filters.minMagnitude}`:'',filters.maxMagnitude?`M ≤ ${filters.maxMagnitude}`:'',filters.minDepth?`prof. ≥ ${filters.minDepth} km`:'',filters.maxDepth?`prof. ≤ ${filters.maxDepth} km`:'',filters.radius?`radio: ${filters.radius} km`:'',filters.polygon?'zona poligonal':''].filter(Boolean).join(' · '):''
  const context=`IGP / CENSIS · ${events.length} eventos · periodo UTC: ${filters?.since||new Date(Date.parse(cutoff)-days*86400000).toISOString().slice(0,10)} a ${filters?.until||cutoff.slice(0,10)} · corte: ${fecha(cutoff)} (Perú)${filterContext?' · '+filterContext:''}`
  return <>{!compact&&<div className="metrics-grid"><Metric icon="event" title="Tamaño de muestra" value={String(events.length)} note="Observaciones del filtro actual" accent/><Metric icon="chart" title="Magnitud promedio" value={magnitudes.length?number(magnitudes.reduce((s,m)=>s+m,0)/magnitudes.length,2):'—'} note="Media de magnitudes reportadas"/><Metric icon="depth" title="Profundidad promedio" value={averageDepth===null?'—':`${number(averageDepth)} km`} note="Según el conjunto seleccionado"/><Metric icon="info" title="Magnitud sin dato" value={String(events.length-magnitudes.length)} note="Excluida del promedio"/></div>}
    <div className="analysis-grid"><Panel title="Distribución por magnitud" description="Participación de cada rango en la muestra."><div className="bar-chart magnitude-distribution" role="img" aria-label={ranges.map(d=>`${d.label}: ${d.value} eventos`).join('; ')}>{ranges.map(r=><div className="distribution-item" key={r.label}><div className="distribution-label"><span><i style={{backgroundColor:r.color}} aria-hidden="true"/>{r.label}</span><strong>{r.value}<small>{magnitudes.length?number(r.value/magnitudes.length*100):'0'} %</small></strong></div><div className="distribution-track"><div style={{width:`${magnitudes.length?r.value/magnitudes.length*100:0}%`,backgroundColor:r.color}}/></div></div>)}</div><p className="distribution-note">{magnitudes.length} eventos con magnitud disponible. Los valores sin dato se excluyen de esta distribución.</p><p className="chart-context">{context}</p></Panel>
    <Panel title="Actividad diaria" description={dailyCounts.length?`Del ${dailyCounts[0].label} al ${dailyCounts.at(-1)?.label} · fechas UTC`:'Sin fechas en el rango'} action={<label className="field chart-select"><span>Agrupación temporal</span><select aria-label="Agrupación temporal" value={group} onChange={e=>setGroup(e.target.value as Grouping)}><option value="dia">Por día</option><option value="semana">Por semana · lunes</option><option value="mes">Por mes</option></select></label>}><DailyChart data={dailyCounts}/><details className="daily-data"><summary>Consultar datos diarios</summary><DataTable rows={dailyCounts.map(d=>[d.date,d.value])} headers={['Inicio del intervalo UTC','Eventos']}/></details><p className="chart-context">{context} · intervalos de calendario UTC.</p></Panel></div>
    {!compact&&<><div className="analysis-grid"><Panel title="Distribución por profundidad" description="Intervalos en kilómetros; conteo desde cero." action={<label className="field chart-select"><span>Resolución de profundidad</span><select aria-label="Resolución de profundidad" value={depthStep} onChange={e=>setDepthStep(Number(e.target.value))}><option value={25}>25 km</option><option value={50}>50 km</option><option value={100}>100 km</option></select></label>}><CountBars data={depthBuckets(events,depthStep)}/><p className="chart-context">{context}</p></Panel><Panel title="Eventos por región" description="Departamento informado por el IGP; incluye registros sin región."><CountBars data={regionData}/><p className="chart-context">{context}</p></Panel></div>
    <Panel title="Magnitud y profundidad" description="Relación descriptiva entre variables; no demuestra causalidad." action={<div className="scatter-controls">{([['X',x,setX],['Y',y,setY]] as const).map(([label,value,change])=><label className="field chart-select" key={label}><span>Variable {label}</span><select aria-label={`Variable ${label}`} value={value} onChange={e=>change(e.target.value as typeof x)}><option value="profundidad">Profundidad (km)</option><option value="magnitud">Magnitud</option></select></label>)}</div>}><Scatter events={events} x={x} y={y}/><p className="chart-context">{context} · se excluyen {events.length-magnitudes.length} registros sin magnitud.</p><details className="daily-data"><summary>Consultar observaciones del análisis</summary><DataTable headers={['ID IGP','Región','Magnitud','Profundidad (km)','Fecha UTC']} rows={events.map(e=>[e.id_externo,e.region||'Sin región',e.magnitud??'Sin dato',e.profundidad,e.ocurrido_en])}/>{onExport&&<Button icon="download" onClick={onExport}>Exportar muestra a Excel</Button>}</details></Panel></>}
    <p className="context-note">Fuente: IGP / CENSIS · muestra: {events.length} eventos · se aplican los filtros del catálogo. El análisis es descriptivo y no constituye una predicción.</p></>
}
function DataTable({rows,headers}:{rows:(string|number)[][];headers:string[]}){return <div className="daily-table-scroll" tabIndex={0} role="region" aria-label="Datos del gráfico"><table><caption className="sr-only">Datos utilizados en el gráfico</caption><thead><tr>{headers.map(h=><th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((v,j)=><td key={j}>{v}</td>)}</tr>)}</tbody></table></div>}
function CountBars({data}:{data:{label:string;value:number}[]}){const max=Math.max(1,...data.map(r=>r.value));return <div className="count-bars">{data.map(r=><div className="count-bar" key={r.label}><span>{r.label}</span><div><i style={{width:`${r.value/max*100}%`}}/></div><strong>{r.value}</strong></div>)}</div>}
function Scatter({events,x,y}:{events:EventoSismico[];x:'profundidad'|'magnitud';y:'profundidad'|'magnitud'}) {
  const container=useRef<HTMLDivElement>(null)
  const [width,setWidth]=useState(700)
  useEffect(()=>{
    const element=container.current
    if(!element)return
    const observer=new ResizeObserver(()=>setWidth(Math.min(700,Math.max(240,element.clientWidth))))
    observer.observe(element)
    return ()=>observer.disconnect()
  },[])
  const points=events.filter(e=>e.magnitud!==null)
  const xmax=Math.max(x==='magnitud'?1:10,...points.map(e=>e[x] as number))*1.05
  const ymax=Math.max(y==='magnitud'?1:10,...points.map(e=>e[y] as number))*1.05
  const label=(v:typeof x)=>v==='magnitud'?'Magnitud':'Profundidad (km)'
  const left=42, right=width-18, top=33, bottom=225, ticks=width<420?3:4
  return <div className="scatter-chart" ref={container}><svg viewBox={`0 0 ${width} 280`} role="img" aria-label={`Dispersión: ${label(x)} en X, ${label(y)} en Y, ${points.length} observaciones. Valores en la tabla inferior.`}>
    {Array.from({length:ticks+1},(_,i)=><g key={i}>
      <line x1={left} x2={right} y1={bottom-i*(bottom-top)/ticks} y2={bottom-i*(bottom-top)/ticks} className="chart-gridline"/>
      <text x={left-8} y={bottom+4-i*(bottom-top)/ticks} textAnchor="end" className="chart-axis-label">{number(ymax*i/ticks)}</text>
      <text x={left+i*(right-left)/ticks} y={247} textAnchor={i===ticks?'end':i===0?'start':'middle'} className="chart-axis-label">{number(xmax*i/ticks)}</text>
    </g>)}
    {points.map(e=><circle key={e.id} cx={left+Number(e[x])/xmax*(right-left)} cy={bottom-Number(e[y])/ymax*(bottom-top)} r="4" fill="#65d6de" fillOpacity=".65"><title>{e.id_externo}: {label(x)} {e[x]}, {label(y)} {e[y]}</title></circle>)}
    <text x={(left+right)/2} y="276" textAnchor="middle" className="chart-axis-label">{label(x)}</text>
    <text x="6" y="15" className="chart-axis-label">{label(y)}</text>
  </svg></div>
}

function DailyChart({ data }: { data: { date:string; label:string; value:number }[] }) {
  const container = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(560)
  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => setWidth(Math.max(220, element.clientWidth)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const max = Math.max(...data.map(day => day.value))
  const upper = Math.max(4, Math.ceil(max / 4) * 4)
  const plot = { left:30, right:12, top:20, bottom:207 }
  const step = (width - plot.left - plot.right) / data.length
  const labelEvery = Math.max(1, Math.ceil((data.length - 1) / (width < 420 ? 3 : 5)))
  return <div className="bar-chart daily-chart" ref={container}><svg viewBox={`0 0 ${width} 240`} role="img" aria-label={`Eventos diarios en UTC. ${data.length} fechas. Máximo de ${max} eventos en un día. Consulta los valores exactos en la tabla de datos diarios.`}>
    <text className="chart-axis-title" x={plot.left} y={10}>Eventos</text>
    {[0, 1, 2, 3, 4].map(tick => {
      const value = tick * upper / 4
      const y = plot.bottom - tick * (plot.bottom - plot.top) / 4
      return <g key={tick}><line className="chart-gridline" x1={plot.left} x2={width - plot.right} y1={y} y2={y} /><text className="chart-axis-label" x={plot.left - 9} y={y + 4} textAnchor="end">{value}</text></g>
    })}
    {data.map((day, index) => {
      const height = day.value / upper * (plot.bottom - plot.top)
      const x = plot.left + index * step + step * .15
      return <g key={day.date}><rect className="daily-bar" x={x} y={plot.bottom - height} width={Math.max(1, step * .7)} height={height} rx={Math.min(3, step * .15)}><title>{day.date} UTC: {day.value} eventos</title></rect>{(index % labelEvery === 0 || index === data.length - 1) && <text className="chart-axis-label" x={x + step * .35} y={227} textAnchor={index === 0 ? 'start' : index === data.length - 1 ? 'end' : 'middle'}>{day.label}</text>}</g>
    })}
  </svg><p className="daily-chart-note">Cada barra representa un intervalo. Los intervalos sin eventos conservan el valor cero.</p></div>
}
