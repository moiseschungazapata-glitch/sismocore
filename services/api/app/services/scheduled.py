"""Bounded synchronization shared by HTTP cron, CLI and local background runner."""
import asyncio
import logging
from uuid import uuid4
from app.services.database import database
from app.services.ingestion import Ingestion
from app.services.catalog import catalog
from app.services.alerts import process_alerts

logger = logging.getLogger('sismocore')


async def synchronize(worker=None):
    reservation = str(uuid4())
    acquired = await database.request('POST', 'rpc/sismocore_adquirir_sincronizacion',
        data={'p_reserva': reservation})
    if not acquired:
        return {'estado': 'omitida', 'motivo': 'en_curso_reciente_o_fuente_inactiva'}
    result = 'fallida'
    try:
        async with asyncio.timeout(210):
            worker = worker or Ingestion()
            await worker.sync()
            if worker.state == 'otra_ejecucion':
                result = 'omitida'
                return {'estado': result, 'motivo': 'otra_ingesta_en_curso'}
            if worker.state != 'actualizada':
                raise RuntimeError('La sincronización no terminó correctamente.')
            catalog.expires = 0
            alerts = await process_alerts()
            result = 'completada'
            return {'estado': result, 'avisos': alerts}
    finally:
        # A crash leaves an expiring lease. Never hold an HTTP response indefinitely.
        try:
            async with asyncio.timeout(8):
                await database.request('POST', 'rpc/sismocore_finalizar_sincronizacion',
                    data={'p_reserva': reservation, 'p_estado': result})
        except (Exception, asyncio.CancelledError):
            logger.warning('No se pudo cerrar la reserva de sincronización; expirará automáticamente.')
