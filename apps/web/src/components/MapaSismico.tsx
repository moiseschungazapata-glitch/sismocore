import { igpReportUrl } from '../lib/igp'

import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { EventoSismico } from "../services/api";
import { magnitudeScale, magnitudeStyle } from "../lib/format";

interface MapaSismicoProps {
  eventos: EventoSismico[];
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

  useEffect(() => {
    if (eventos.length === 0) return;

    const coordenadas = eventos.map(
      (evento) =>
        L.latLng(evento.latitud, evento.longitud)
    );

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
          maxZoom: 6,
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
  }, [eventos, mapa]);

  return null;
}

export default function MapaSismico({
  eventos,
}: MapaSismicoProps) {
  const [style, setStyle] = useState<MapStyle>(initialStyle);
  const [tileError, setTileError] = useState(false);
  function changeStyle() {
    const next = style === 'mapa' ? 'satelite' : 'mapa';
    setStyle(next); setTileError(false);
    try { localStorage.setItem(preferenceKey, next); } catch { /* Optional visual preference. */ }
  }
  return (
    <section aria-label="Mapa de eventos sísmicos observados">
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

        {eventos.map((evento) => (
          <CircleMarker
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
        ))}
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
