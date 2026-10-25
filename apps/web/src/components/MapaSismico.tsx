import { igpReportUrl } from '../lib/igp'

import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Circle, Polygon, Polyline, Tooltip, useMapEvents,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { polygonPoints, type Filters } from '../lib/filters';
import { Button } from './ui';
import type { EventoSismico } from "../services/api";
import { magnitudeScale, magnitudeStyle } from "../lib/format";

interface MapaSismicoProps {
  eventos: EventoSismico[];
  filters?: Filters;
  onAreaChange?: (filters:Filters)=>void;
}

type MapStyle = 'mapa' | 'satelite';
const preferenceKey = 'sismocore.map-style.v1';
const nasaBase = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
const satelliteTiles = `${nasaBase}/BlueMarble_ShadedRelief_Bathymetry/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`;
const nasaAttribution = '<a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a> / <a href="https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/">Blue Marble</a>';

function initialStyle(): MapStyle {
  try { return localStorage.getItem(preferenceKey) === 'satelite' ? 'satelite' : 'mapa'; }
  catch { return 'mapa'; }
}

function AjustarVista({ eventos }: MapaSismicoProps) {
  const mapa = useMap();
  const coordinateKey=JSON.stringify(eventos.map(e=>[e.latitud,e.longitud]));

  useEffect(() => {
    const values=JSON.parse(coordinateKey) as [number,number][];
    if (values.length === 0) return;
    const coordenadas = values.map(([lat,lon])=>L.latLng(lat,lon));

    let frame = 0;
    let disposed = false;
    const ajustar = () => {
      if (disposed) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed || !mapa.getContainer().isConnected) return;
        mapa.invalidateSize({ pan: false });
        mapa.fitBounds(L.latLngBounds(coordenadas), {
          padding: [30, 30],
          maxZoom: values.length===1 ? 9 : 6,
          animate: false,
        });
      });
    };
    ajustar();
    const observer = new ResizeObserver(ajustar);
    observer.observe(mapa.getContainer());
    return () => {
      disposed = true;
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [coordinateKey, mapa]);

  return null;
}

export default function MapaSismico({
  eventos, filters, onAreaChange,
}: MapaSismicoProps) {
  const [drawing,setDrawing]=useState(false);
  const [draft,setDraft]=useState<[number,number][]>([]);
  const [cluster,setCluster]=useState(true);
  const [style, setStyle] = useState<MapStyle>(initialStyle);
  const [tileError, setTileError] = useState(false);
  function changeStyle() {
    const next = style === 'mapa' ? 'satelite' : 'mapa';
    setStyle(next); setTileError(false);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Optional visual preference. */ }
  }
  return (
    <section aria-label="Mapa de eventos sísmicos observados">
    {onAreaChange&&filters&&<div className="map-tools"><label className="map-checkbox"><input type="checkbox" checked={cluster} onChange={e=>setCluster(e.target.checked)}/>Agrupar puntos cercanos</label><div className="map-tool-buttons"><Button onClick={()=>{setDrawing(!drawing);setDraft([])}}>{drawing?'Cancelar dibujo':'Dibujar polígono'}</Button>{drawing&&<Button variant="primary" disabled={draft.length<3} onClick={()=>{onAreaChange({...filters,polygon:JSON.stringify(draft)});setDrawing(false);setDraft([])}}>Aplicar zona ({draft.length} puntos)</Button>}{filters.polygon&&<Button onClick={()=>onAreaChange({...filters,polygon:''})}>Quitar polígono</Button>}</div></div>}
    {drawing&&<p className="field-help" role="status">Pulsa en el mapa para añadir de 3 a 50 vértices y selecciona Aplicar zona. Coordenadas: {draft.map(([a,b])=>`${a.toFixed(3)}, ${b.toFixed(3)}`).join(' · ')||'ninguna'}.</p>}
    <div className="map-frame">
      <MapContainer
        center={[-9.19, -75.015]}
        zoom={5}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
        zoomAnimation={false}
        fadeAnimation={false}
        markerZoomAnimation={false}
      >
        {style === 'mapa' ? <TileLayer
          key="mapa"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          eventHandlers={{ tileerror: () => setTileError(true) }}
        /> : <>
          <TileLayer key="satelite" url={satelliteTiles} attribution={nasaAttribution} maxNativeZoom={8} maxZoom={19} eventHandlers={{ tileerror: () => setTileError(true) }} />
          <TileLayer key="fronteras" url={`${nasaBase}/Reference_Features/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`} maxNativeZoom={9} maxZoom={19} />
          <TileLayer key="nombres" url={`${nasaBase}/Reference_Labels/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`} maxNativeZoom={9} maxZoom={19} />
        </>}

        <AjustarVista eventos={eventos} />

        <MapObservations eventos={eventos} grouped={cluster} drawing={drawing} onPoint={point=>setDraft(old=>old.length<50?[...old,point]:old)}/>
        {filters?.radius&&filters.latitude&&filters.longitude&&<Circle center={[Number(filters.latitude),Number(filters.longitude)]} radius={Number(filters.radius)*1000} pathOptions={{color:'#8fe5df',fillOpacity:.04,dashArray:'6 4'}}/>}
        {!!polygonPoints(filters?.polygon).length&&<Polygon positions={polygonPoints(filters?.polygon)} pathOptions={{color:'#8fe5df',fillOpacity:.05,dashArray:'6 4'}}/>}
        {draft.length>0&&<Polyline positions={draft} pathOptions={{color:'#ffda80'}}/>}
      </MapContainer>
      <button type="button" className={`map-style-switch map-style-switch--${style === 'mapa' ? 'satellite' : 'streets'}`} aria-label={style === 'mapa' ? 'Cambiar a vista satelital' : 'Cambiar a vista de mapa'} onClick={changeStyle}>
        <span className="map-style-preview" aria-hidden="true" /><span>{style === 'mapa' ? 'Satélite' : 'Mapa'}</span>
      </button>
    </div>
    <p className="sr-only" role="status">{style === 'satelite' ? 'Vista satelital seleccionada.' : 'Vista de mapa seleccionada.'}</p>
    {tileError && <p className="map-load-error" role="alert">No se pudieron cargar algunas imágenes del mapa. Comprueba tu conexión{style === 'satelite' ? ' o cambia a la vista Mapa.' : ' y vuelve a intentarlo.'}</p>}
    <div className="map-legend" aria-label="Leyenda por magnitud"><strong>Magnitud reportada</strong>{magnitudeScale.map(rango => <span className="map-legend-item" key={rango.key}><span className="map-swatch" style={{ backgroundColor: rango.color }} aria-hidden="true" />{rango.label}</span>)}</div>
    <p className="map-note">El color y el tamaño representan magnitud, no un nivel oficial de peligro ni una zona de impacto.</p>
    {style === 'satelite' && <p className="map-note">Imagen de referencia de NASA para observar regiones y relieve; no es en tiempo real. Para consultar calles con más detalle, cambia a Mapa.</p>}
    </section>
  );
}

function MapObservations({eventos,grouped,drawing,onPoint}:{eventos:EventoSismico[];grouped:boolean;drawing:boolean;onPoint:(point:[number,number])=>void}){
 const [zoom,setZoom]=useState(5)
 const map=useMapEvents({zoomend(){setZoom(map.getZoom())},click(e){if(drawing)onPoint([Number(e.latlng.lat.toFixed(5)),Number(e.latlng.lng.toFixed(5))])}})
 const groups=new Map<string,EventoSismico[]>()
 eventos.forEach(e=>{const p=map.project([e.latitud,e.longitud],zoom);const key=grouped&&zoom<12?`${Math.floor(p.x/55)}:${Math.floor(p.y/55)}`:e.id;groups.set(key,[...(groups.get(key)||[]),e])})
 return <>{[...groups].map(([key,items])=>{
   if(items.length>1){const center:[number,number]=[items.reduce((s,e)=>s+e.latitud,0)/items.length,items.reduce((s,e)=>s+e.longitud,0)/items.length];return <CircleMarker key={key} center={center} radius={18} pathOptions={{color:'#b9f4ed',fillColor:'#145a68',fillOpacity:.95,weight:2}} eventHandlers={{click(e){L.DomEvent.stopPropagation(e.originalEvent);if(!drawing)map.setView(center,Math.min(zoom+2,12))}}}><Tooltip permanent direction="center" className="cluster-label">{items.length}</Tooltip><Popup>{items.length} eventos agrupados. Acerca el mapa para separarlos.<br/><button type="button" onClick={()=>map.setView(center,Math.min(zoom+2,12))}>Acercar grupo</button></Popup></CircleMarker>}
   const evento=items[0]
   return (          <CircleMarker
            key={evento.id}
            center={[evento.latitud, evento.longitud]}
            radius={
              evento.magnitud === null
                ? 6
                : Math.max(6, evento.magnitud * 2)
            }
            pathOptions={{
              color: magnitudeStyle(evento.magnitud).color,
              fillColor: magnitudeStyle(evento.magnitud).color,
              fillOpacity: 0.75,
              weight: 2,
            }}
          >
            <Popup>
              <strong>{evento.lugar}</strong>
              <br />
              Magnitud: {evento.magnitud ?? "No disponible"}
              <br />
              Profundidad: {evento.profundidad} km
              <br />
              Latitud: {evento.latitud}
              <br />
              Longitud: {evento.longitud}
              <br />
              Fecha UTC: {evento.ocurrido_en}
              <br />
              <a href={igpReportUrl(evento)} target="_blank" rel="noreferrer">Ver evento original en IGP / CENSIS</a>
            </Popup>
          </CircleMarker>
)
 })}</>
}
