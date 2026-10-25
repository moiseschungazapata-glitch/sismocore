import asyncio
import json
import logging
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import httpx

from app.core.config import settings
from app.services.database import DatabaseError, database
from app.services.igp import IGP_URL, SOURCE_CODE, SOURCE_NAME, normalize, query_params

logger = logging.getLogger('sismocore')


def utcnow():
    return datetime.now(timezone.utc).isoformat()


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
                    'codigo': f'eq.{SOURCE_CODE}', 'select': 'id,activa,parametros', 'limit': '1',
                })
                if not sources:
                    await database.request('POST', 'fuentes_datos', params={'on_conflict': 'codigo'}, data={
                        'codigo': SOURCE_CODE, 'nombre': SOURCE_NAME, 'organizacion': 'Instituto Geofísico del Perú',
                        'url_api': IGP_URL, 'tipo': 'arcgis_json', 'frecuencia_segundos': settings.SYNC_INTERVAL_SECONDS,
                        'parametros': {'dias': settings.CATALOG_DAYS},
                    }, prefer='resolution=ignore-duplicates,return=minimal')
                    sources = await database.request('GET', 'fuentes_datos', params={
                        'codigo': f'eq.{SOURCE_CODE}', 'select': 'id,activa,parametros', 'limit': '1',
                    })
                if not sources:
                    raise ValueError('No se pudo registrar el conector IGP.')
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
                params = query_params(settings.CATALOG_DAYS, now)
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
                logger.info('Sincronización IGP completada: %s', counters)
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
                    'No se pudo sincronizar IGP. Los registros guardados siguen disponibles.'
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
        offset = 0
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                response = await client.get(IGP_URL, params={**params, 'resultOffset': offset})
                response.raise_for_status()
                if response.status_code == 204:
                    break
                payload = response.json()
                features = payload.get('features')
                if 'error' in payload or not isinstance(features, list):
                    raise ValueError('Respuesta IGP inválida')
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
                            (old.get('actualizado_fuente_en') and event.get('actualizado_fuente_en') and
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
                if not payload.get('exceededTransferLimit', len(features) == params['resultRecordCount']):
                    break
                if not features:
                    raise ValueError('Paginación IGP sin progreso')
                offset += len(features)
        return counters

    async def run(self):
        while True:
            from app.services.scheduled import synchronize
            try:
                await synchronize(worker=self)
            except Exception as exc:
                logger.warning('Sincronización programada incompleta (%s).',type(exc).__name__)
            await asyncio.sleep(settings.SYNC_INTERVAL_SECONDS)


ingestion = Ingestion()
