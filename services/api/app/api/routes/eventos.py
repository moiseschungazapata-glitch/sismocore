
from datetime import datetime, timedelta, timezone
from json import load
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from fastapi import APIRouter, HTTPException

router = APIRouter(
    prefix="/eventos",
    tags=["Eventos sísmicos"],
)

USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"


@router.get("/")
def listar_eventos():
    # Consultar los últimos 7 días en la zona geográfica del Perú.
    ahora = datetime.now(timezone.utc)
    inicio = ahora - timedelta(days=7)

    parametros = {
        "format": "geojson",
        "starttime": inicio.strftime("%Y-%m-%dT%H:%M:%S"),
        "endtime": ahora.strftime("%Y-%m-%dT%H:%M:%S"),
        "minlatitude": -20,
        "maxlatitude": 0,
        "minlongitude": -82,
        "maxlongitude": -68,
        "minmagnitude": 2.5,
        "orderby": "time",
        "limit": 200,
        "eventtype": "earthquake",
    }

    url = f"{USGS_URL}?{urlencode(parametros)}"

    try:
        with urlopen(url, timeout=15) as respuesta:
            datos = load(respuesta)

    except (HTTPError, URLError, TimeoutError, OSError) as error:
        raise HTTPException(
            status_code=502,
            detail="No se pudo consultar la fuente sísmica USGS.",
        ) from error

    eventos = []

    for elemento in datos.get("features", []):
        propiedades = elemento.get("properties", {})
        geometria = elemento.get("geometry") or {}
        coordenadas = geometria.get("coordinates") or []

        # USGS entrega las coordenadas como longitud, latitud y profundidad.
        if len(coordenadas) < 3:
            continue

        longitud, latitud, profundidad = coordenadas[:3]

        eventos.append({
            "id": elemento.get("id", ""),
            "magnitud": propiedades.get("mag"),
            "lugar": propiedades.get("place") or "Ubicación no especificada",
            "latitud": latitud,
            "longitud": longitud,
            "profundidad": profundidad,
        })

    return {
        "total": len(eventos),
        "eventos": eventos,
        "fuente": "USGS Earthquake Hazards Program",
        "mensaje": (
            "Eventos sísmicos reales de los últimos 7 días "
            "en la zona geográfica consultada del Perú."
        ),
    }
