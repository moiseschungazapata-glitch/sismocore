import asyncio
from datetime import datetime, timedelta, timezone
from time import monotonic

from app.services.database import database
from app.services.ingestion import ingestion
from app.core.config import settings
from app.services.igp import SOURCE_CODE, SOURCE_NAME, IGP_PORTAL


class Catalog:
    def __init__(self):
        self.cached = None
        self.expires = 0
        self.lock = asyncio.Lock()

    async def read(self):
        async with self.lock:
            if self.cached is not None and monotonic() < self.expires:
                return self.cached
            sources = await database.request('GET', 'fuentes_datos', params={
                'codigo': f'eq.{SOURCE_CODE}', 'select': 'id', 'limit': '1',
            })
            source_id = sources[0]['id'] if sources else None
            start = (datetime.now(timezone.utc) - timedelta(days=settings.CATALOG_DAYS)).isoformat()
            events = []
            offset = 0
            while source_id:
                page = await database.request('GET', 'eventos_sismicos', params={
                    'select': 'id,id_externo,magnitud,tipo_magnitud,lugar,profundidad,latitud,longitud,ocurrido_en,url_fuente,estado_revision',
                    'fuente_id': f'eq.{source_id}', 'ocurrido_en': f'gte.{start}', 'order': 'ocurrido_en.desc,id',
                    'limit': '1000', 'offset': str(offset),
                })
                events.extend(page)
                if len(page) < 1000:
                    break
                offset += 1000
            runs = await database.request('GET', 'ejecuciones_ingesta', params={
                'select': 'estado,iniciado_en,finalizado_en,registros_recibidos,registros_insertados,registros_actualizados,registros_rechazados,error_resumen',
                'fuente_id': f'eq.{source_id}', 'order': 'iniciado_en.desc', 'limit': '1',
            }) if source_id else []
            successes = await database.request('GET', 'ejecuciones_ingesta', params={
                'select': 'finalizado_en', 'estado': 'eq.completada',
                'fuente_id': f'eq.{source_id}', 'order': 'finalizado_en.desc', 'limit': '1',
            }) if source_id else []
            response = {
                'total': len(events), 'eventos': events,
                'fuente': SOURCE_NAME, 'codigo_fuente': SOURCE_CODE, 'url_fuente': IGP_PORTAL,
                'frecuencia_segundos': settings.SYNC_INTERVAL_SECONDS, 'almacenamiento': 'Supabase',
                'periodo_dias': settings.CATALOG_DAYS, 'ultima_sincronizacion': successes[0]['finalizado_en'] if successes else None,
                'consultado_en': datetime.now(timezone.utc).isoformat(),
                'sincronizacion': ingestion.state,
                'ultima_ejecucion': runs[0] if runs else None,
                'mensaje': f'Reportes del IGP/CENSIS guardados en Supabase; últimos {settings.CATALOG_DAYS} días. La frecuencia de consulta no garantiza nuevos reportes de la fuente.',
            }
            self.cached, self.expires = response, monotonic() + 10
            return response


catalog = Catalog()
