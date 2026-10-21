
const API_URL = "http://127.0.0.1:8000";

export interface HealthResponse {
  estado: string;
  servicio: string;
  mensaje?: string;
}

export interface EventoSismico {
  id: string;
  magnitud: number | null;
  lugar: string;
  latitud: number;
  longitud: number;
  profundidad: number;
}

export interface EventosResponse {
  total: number;
  eventos: EventoSismico[];
  fuente: string;
  mensaje: string;
}

export async function verificarAPI(): Promise<HealthResponse> {
  const response = await fetch(`${API_URL}/health`);

  if (!response.ok) {
    throw new Error("No se pudo verificar el estado de la API.");
  }

  return response.json() as Promise<HealthResponse>;
}

export async function obtenerEventos(): Promise<EventosResponse> {
  const response = await fetch(`${API_URL}/api/v1/eventos/`);

  if (!response.ok) {
    throw new Error("No se pudieron obtener los eventos sísmicos.");
  }

  return response.json() as Promise<EventosResponse>;
}
