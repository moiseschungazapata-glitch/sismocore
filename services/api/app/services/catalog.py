import asyncio
from datetime import datetime, timedelta, timezone
from time import monotonic

from app.services.database import database
from app.services.ingestion import ingestion


class Catalog:
    def __init__(self):
        self.cached = None
        self.expires = 0
        self.lock = asyncio.Lock()

    async def read(self):
        async with self.lock:
            if self.cached is not None and monotonic() < self.expires:
                return self.cached
            start = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
            events = []
            offset = 0
            while True:
                page = await database.request('GET', 'eventos_sismicos', params={
                    'select': 'id,id_externo,magnitud,tipo_magnitud,lugar,profundidad,latitud,longitud,ocurrido_en,url_fuente,estado_revision',
                    'ocurrido_en': f'gte.{start}', 'order': 'ocurrido_en.desc,id',
                    'limit': '1000', 'offset': str(offset),
                })
                events.extend(page)
                if len(page) < 1000:
                    break
                offset += 1000
            runs = await database.request('GET', 'ejecuciones_ingesta', params={
                'select': 'estado,iniciado_en,finalizado_en,registros_recibidos,registros_insertados,registros_actualizados,registros_rechazados,error_resumen',
                'order': 'iniciado_en.desc', 'limit': '1',
            })
            successes = await database.request('GET', 'ejecuciones_ingesta', params={
                'select': 'finalizado_en', 'estado': 'eq.completada',
                'order': 'finalizado_en.desc', 'limit': '1',
            })
            response = {
                'total': len(events), 'eventos': events,
                'fuente': 'USGS Earthquake Hazards Program', 'almacenamiento': 'Supabase',
                'periodo_dias': 7, 'ultima_sincronizacion': successes[0]['finalizado_en'] if successes else None,
                'consultado_en': datetime.now(timezone.utc).isoformat(),
                'sincronizacion': ingestion.state,
                'ultima_ejecucion': runs[0] if runs else None,
                'mensaje': 'Eventos observados guardados en Supabase; últimos siete días en el área de consulta alrededor del Perú.',
            }
            self.cached, self.expires = response, monotonic() + 10
            return response


catalog = Catalog()
