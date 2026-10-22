
import { useEffect } from "react";
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
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

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
              <a href={evento.url_fuente} target="_blank" rel="noreferrer">Ver evento original en IGP / CENSIS</a>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
    <div className="map-legend" aria-label="Leyenda por magnitud"><strong>Magnitud reportada</strong>{magnitudeScale.map(rango => <span className="map-legend-item" key={rango.key}><span className="map-swatch" style={{ backgroundColor: rango.color }} aria-hidden="true" />{rango.label}</span>)}</div>
    <p className="map-note">El color y el tamaño representan magnitud, no un nivel oficial de peligro ni una zona de impacto.</p>
    </section>
  );
}
