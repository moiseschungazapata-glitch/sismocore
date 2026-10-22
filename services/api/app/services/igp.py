"""Public IGP/CENSIS ArcGIS adapter; no API key is sent to this service."""
import hashlib
import json
import math
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode

SOURCE_CODE = 'igp'
SOURCE_NAME = 'IGP / CENSIS'
IGP_URL = 'https://ide.igp.gob.pe/arcgis/rest/services/monitoreocensis/SismosReportados/MapServer/0/query'
IGP_PORTAL = 'https://ultimosismo.igp.gob.pe/productos/reportes-sismicos'
PERU = timezone(timedelta(hours=-5))


def query_params(days, now):
    start = (now - timedelta(days=days)).astimezone(PERU).strftime('%Y-%m-%d %H:%M:%S')
    end = now.astimezone(PERU).strftime('%Y-%m-%d %H:%M:%S')
    return {
        'f': 'json',
        'where': f"fechaevento >= timestamp '{start}' AND fechaevento <= timestamp '{end}'",
        'outFields': 'objectid,code,fechaevento,magnitud,prof,lat,lon,ref,departamento',
        'returnGeometry': 'false', 'orderByFields': 'fechaevento ASC,objectid ASC',
        'resultRecordCount': 1000,
    }


def numeric(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Valor numérico inválido')
    return value


def normalize(feature):
    try:
        a = feature['attributes']
        code = a['code']
        if not isinstance(code, str) or not re.fullmatch(r'\d{4}-\d{1,5}', code):
            raise ValueError('Código IGP ausente o inválido')
        lat, lon, depth = (numeric(a[key]) for key in ['lat', 'lon', 'prof'])
        if not -90 <= lat <= 90 or not -180 <= lon <= 180 or not 0 <= depth <= 1000:
            raise ValueError('Coordenadas o profundidad fuera de rango')
        # ArcGIS serializes date fields as UTC epoch milliseconds. Do not add 5h again.
        occurred = datetime.fromtimestamp(numeric(a['fechaevento']) / 1000, timezone.utc)
        magnitude = None if a.get('magnitud') is None else numeric(a['magnitud'])
        if magnitude is not None and not 0 <= magnitude <= 10:
            raise ValueError('Magnitud fuera de rango')
        event = {
            'id_externo': code, 'ocurrido_en': occurred.isoformat(),
            'latitud': lat, 'longitud': lon, 'profundidad': depth,
            'magnitud': magnitude, 'tipo_magnitud': None,
            'lugar': a.get('ref') or 'Ubicación no especificada',
            'region': a.get('departamento') or None,
            'estado_revision': 'reportado_igp',
            'url_fuente': IGP_URL + '?' + urlencode({
                'where': f"code='{code}'", 'outFields': '*', 'returnGeometry': 'false', 'f': 'pjson',
            }),
            # This layer does not publish a last-modified timestamp or magnitude scale.
            'actualizado_fuente_en': None,
        }
        if not isinstance(event['lugar'], str) or (event['region'] is not None and not isinstance(event['region'], str)):
            raise ValueError('Referencia inválida')
        event['hash_origen'] = hashlib.sha256(json.dumps(
            event, sort_keys=True, ensure_ascii=False, separators=(',', ':')
        ).encode()).hexdigest()
        return event
    except (KeyError, TypeError, ValueError, OverflowError, OSError) as exc:
        raise ValueError('Registro IGP incompleto o inválido') from exc
