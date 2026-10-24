import { useEffect,useId,useRef } from 'react'
import { Icon } from '../../components/Icon'
import type { Channel } from '../../services/alerts'

const options:{value:Channel;label:string;note?:string}[]=[
  {value:'push',label:'Notificación'},
  {value:'voz',label:'Llamada'},
  {value:'sms',label:'SMS',note:'Demostración Trial'},
]

export default function ChannelSelector({value,onChange}:{value:Channel[];onChange:(channels:Channel[])=>void}){
  const picker=useRef<HTMLDetailsElement>(null)
  const labelId=useId()
  const valueId=useId()
  useEffect(()=>{
    const close=(event:PointerEvent)=>{if(event.target instanceof Node&&!picker.current?.contains(event.target)&&picker.current)picker.current.open=false}
    document.addEventListener('pointerdown',close)
    return()=>document.removeEventListener('pointerdown',close)
  },[])
  function toggle(channel:Channel){
    const selected=new Set(value)
    if(selected.has(channel))selected.delete(channel);else selected.add(channel)
    onChange(options.filter(option=>selected.has(option.value)).map(option=>option.value))
  }
  return <div className="field"><span id={labelId}>Canales de aviso</span>
    <details className="channel-picker" ref={picker} onKeyDown={event=>{if(event.key==='Escape'&&picker.current?.open){event.preventDefault();event.stopPropagation();picker.current.open=false;picker.current.querySelector('summary')?.focus()}}}>
      <summary aria-labelledby={`${labelId} ${valueId}`}><span id={valueId}>{options.filter(option=>value.includes(option.value)).map(option=>option.label).join(' · ')||'Selecciona uno o varios canales'}</span><Icon name="chevron" size={16}/></summary>
      <fieldset className="channel-picker-options"><legend className="sr-only">Selecciona los canales de aviso</legend>{options.map(option=><label key={option.value}><input type="checkbox" checked={value.includes(option.value)} onChange={()=>toggle(option.value)}/><span>{option.label}</span>{option.note&&<small>{option.note}</small>}</label>)}{!value.length&&<p>Selecciona al menos un canal.</p>}</fieldset>
    </details>
  </div>
}
