import asyncio
import hashlib
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx

from app.core.config import settings
from app.services.database import DatabaseError, database

logger = logging.getLogger('sismocore')
USGS_URL = 'https://earthquake.usgs.gov/fdsnws/event/1/query'


def utcnow():
    return datetime.now(timezone.utc).isoformat()


def timestamp(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Fecha inválida')
    return datetime.fromtimestamp(value / 1000, timezone.utc).isoformat()


def number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError('Valor numérico inválido')
    return value


def normalize(feature):
    """Validate before storage; incomplete observations are counted, never invented."""
    try:
        properties = feature['properties']
        longitude, latitude, depth = feature['geometry']['coordinates'][:3]
        longitude, latitude, depth = number(longitude), number(latitude), number(depth)
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError('Coordenadas fuera de rango')
        external_id = feature['id']
        source_url = properties['url']
        if not isinstance(external_id, str) or not external_id.strip():
            raise ValueError('Identificador ausente')
        if not isinstance(source_url, str) or not source_url.startswith('https://'):
            raise ValueError('Procedencia ausente')
        event = {
            'id_externo': external_id, 'ocurrido_en': timestamp(properties['time']),
            'latitud': latitude, 'longitud': longitude, 'profundidad': depth,
            'magnitud': None if properties.get('mag') is None else number(properties['mag']),
            'tipo_magnitud': properties.get('magType'),
            'lugar': properties.get('place') or 'Ubicación no especificada',
            'region': None, 'estado_revision': properties.get('status') or 'sin_especificar',
            'url_fuente': source_url,
            'actualizado_fuente_en': timestamp(properties.get('updated', properties['time'])),
        }
        event['hash_origen'] = hashlib.sha256(
            json.dumps(event, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode()
        ).hexdigest()
        return event
    except (KeyError, TypeError, ValueError, OverflowError, OSError) as exc:
        raise ValueError('Registro sísmico incompleto o inválido') from exc


class Ingestion:
    def __init__(self):
        self.lock = asyncio.Lock()
        self.state = 'pendiente'
        self.last_error = None
        self.last_success = None

    async def sync(self):
        async with self.lock:
            run_id = None
            try:
                self.state, self.last_error = 'sincronizando', None
                sources = await database.request('GET', 'fuentes_datos', params={
                    'codigo': 'eq.usgs', 'select': 'id,activa,parametros', 'limit': '1',
                })
                if not sources:
                    raise ValueError('No existe el conector USGS; aplica la migración inicial.')
                source = sources[0]
                if not source['activa']:
                    self.state = 'inactiva'
                    return
                source_id = source['id']
                # Recover abandoned runs after a crashed local process. A run is bounded to 120s.
                cutoff = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
                await database.request('PATCH', 'ejecuciones_ingesta', params={
                    'fuente_id': f'eq.{source_id}', 'estado': 'in.(en_cola,ejecutando)',
                    'iniciado_en': f'lt.{cutoff}',
                }, data={'estado': 'fallida', 'finalizado_en': utcnow(),
                         'error_resumen': 'Ejecución interrumpida antes de finalizar.'})
                now = datetime.now(timezone.utc)
                configured = source.get('parametros') or {}
                params = {
                    'format': 'geojson', 'starttime': (now - timedelta(days=7)).isoformat(),
                    'endtime': now.isoformat(), 'minlatitude': -20, 'maxlatitude': 0,
                    'minlongitude': -82, 'maxlongitude': -68, 'minmagnitude': 2.5,
                    'eventtype': 'earthquake', 'orderby': 'time-asc', 'limit': 1000,
                }
                for key in ['minlatitude', 'maxlatitude', 'minlongitude', 'maxlongitude', 'minmagnitude']:
                    if key in configured:
                        params[key] = configured[key]
                run_id = str(uuid4())
                try:
                    await database.request('POST', 'ejecuciones_ingesta', data={
                        'id': run_id, 'fuente_id': source_id, 'estado': 'ejecutando',
                        'parametros': params, 'iniciado_en': utcnow(),
                    })
                except DatabaseError as exc:
                    run_id = None
                    if exc.status_code == 409:
                        self.state = 'otra_ejecucion'
                        return
                    raise
                async with asyncio.timeout(120):
                    counters = await self._import(source_id, run_id, params)
                finished = utcnow()
                await database.request('PATCH', 'ejecuciones_ingesta',
                    params={'id': f'eq.{run_id}'}, data={
                        'estado': 'completada', 'finalizado_en': finished, **counters,
                        'calidad': {'rechazos': counters['registros_rechazados']},
                    })
                await database.request('PATCH', 'fuentes_datos', params={'id': f'eq.{source_id}'},
                    data={'cursor_sincronizacion': {'ultimo_exito': finished}})
                self.state, self.last_success = 'actualizada', finished
                logger.info('Sincronización USGS completada: %s', counters)
            except asyncio.CancelledError:
                if run_id:
                    try:
                        await database.request('PATCH', 'ejecuciones_ingesta',
                            params={'id': f'eq.{run_id}'}, data={
                                'estado': 'cancelada', 'finalizado_en': utcnow(),
                                'error_resumen': 'Sincronización cancelada al cerrar el servicio.',
                            })
                    except DatabaseError:
                        pass
                raise
            except Exception as exc:
                self.state = 'error'
                self.last_error = (
                    'No se pudo sincronizar USGS. Los registros guardados siguen disponibles.'
                )
                logger.warning('Sincronización no completada (%s).', type(exc).__name__)
                if run_id:
                    try:
                        await database.request('PATCH', 'ejecuciones_ingesta',
                            params={'id': f'eq.{run_id}'}, data={
                                'estado': 'fallida', 'finalizado_en': utcnow(),
                                'error_resumen': self.last_error,
                            })
                    except DatabaseError:
                        pass

    async def _import(self, source_id, run_id, params):
        counters = dict.fromkeys([
            'registros_recibidos', 'registros_insertados', 'registros_actualizados',
            'registros_rechazados', 'registros_sin_cambios',
        ], 0)
        offset = 1
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                response = await client.get(USGS_URL, params={**params, 'offset': offset})
                response.raise_for_status()
                if response.status_code == 204:
                    break
                payload = response.json()
                features = payload.get('features')
                if not isinstance(features, list):
                    raise ValueError('Respuesta USGS inválida')
                valid = []
                for feature in features:
                    counters['registros_recibidos'] += 1
                    try:
                        valid.append(normalize(feature))
                    except ValueError:
                        counters['registros_rechazados'] += 1
                # Bounded batches keep PostgREST URLs short and support more than 1000 records.
                for start in range(0, len(valid), 100):
                    batch = valid[start:start + 100]
                    ids = ','.join(json.dumps(row['id_externo']) for row in batch)
                    previous = await database.request('GET', 'eventos_sismicos', params={
                        'fuente_id': f'eq.{source_id}', 'id_externo': f'in.({ids})',
                        'select': 'id,id_externo,hash_origen,recibido_en,actualizado_fuente_en',
                    })
                    known = {row['id_externo']: row for row in previous}
                    changes = []
                    for event in batch:
                        old = known.get(event['id_externo'])
                        if old and (old['hash_origen'] == event['hash_origen'] or
                            (old.get('actualizado_fuente_en') and
                             datetime.fromisoformat(old['actualizado_fuente_en']) >
                             datetime.fromisoformat(event['actualizado_fuente_en']))):
                            counters['registros_sin_cambios'] += 1
                            continue
                        changes.append({**event, 'fuente_id': source_id, 'ultima_ingesta_id': run_id,
                            'id': old['id'] if old else str(uuid4()),
                            'recibido_en': old['recibido_en'] if old else utcnow()})
                        counters['registros_actualizados' if old else 'registros_insertados'] += 1
                    if changes:
                        await database.request('POST', 'eventos_sismicos',
                            params={'on_conflict': 'fuente_id,id_externo'}, data=changes,
                            prefer='resolution=merge-duplicates,return=minimal')
                if len(features) < params['limit']:
                    break
                offset += len(features)
        return counters

    async def run(self):
        while True:
            await self.sync()
            await asyncio.sleep(settings.SYNC_INTERVAL_SECONDS)


ingestion = Ingestion()
