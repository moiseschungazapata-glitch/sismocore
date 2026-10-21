
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
    const ajustar = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        mapa.invalidateSize({ pan: false });
        mapa.fitBounds(L.latLngBounds(coordenadas), {
          padding: [30, 30],
          maxZoom: 6,
        });
      });
    };
    ajustar();
    const observer = new ResizeObserver(ajustar);
    observer.observe(mapa.getContainer());
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [eventos, mapa]);

  return null;
}

function obtenerColor(magnitud: number | null): string {
  if (magnitud === null) return "#64748b";
  if (magnitud >= 6) return "#dc2626";
  if (magnitud >= 4) return "#f97316";
  if (magnitud >= 2.5) return "#eab308";
  return "#22c55e";
}

export default function MapaSismico({
  eventos,
}: MapaSismicoProps) {
  return (
    <section aria-label="Mapa de eventos sísmicos observados">
    <div
      style={{
        width: "100%",
        height: "480px",
        borderRadius: "12px",
        overflow: "hidden",
      }}
    >
      <MapContainer
        center={[-9.19, -75.015]}
        zoom={5}
        style={{ width: "100%", height: "100%" }}
        scrollWheelZoom
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
              color: obtenerColor(evento.magnitud),
              fillColor: obtenerColor(evento.magnitud),
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
              <a href={evento.url_fuente} target="_blank" rel="noreferrer">Ver evento original en USGS</a>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
    <p className="map-legend">Magnitud: <span style={{ color: '#22c55e' }}>● menor de 2.5</span> · <span style={{ color: '#eab308' }}>● 2.5 a menos de 4</span> · <span style={{ color: '#f97316' }}>● 4 a menos de 6</span> · <span style={{ color: '#dc2626' }}>● 6 o más</span> · <span style={{ color: '#94a3b8' }}>● sin dato</span>. El tamaño del punto no representa un área de impacto.</p>
    </section>
  );
}
