"""Run one IGP synchronization. Used locally and by GitHub Actions."""
import argparse
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services' / 'api'))
from app.core.config import settings
from app.services.database import database
from app.services.ingestion import Ingestion
from app.services.igp import IGP_URL, normalize, query_params
from datetime import datetime, timezone
import httpx


async def main(check_only):
    if check_only:
        # Public source verification only: never opens Supabase or modifies data.
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(IGP_URL, params=query_params(settings.CATALOG_DAYS, datetime.now(timezone.utc)))
            response.raise_for_status()
            payload = response.json()
            if 'error' in payload or not isinstance(payload.get('features'), list):
                raise RuntimeError('Respuesta IGP inválida')
            rows = []
            rejected = 0
            for feature in payload['features']:
                try:
                    rows.append(normalize(feature))
                except ValueError:
                    rejected += 1
            print(json.dumps({'fuente': 'IGP/CENSIS', 'dias': settings.CATALOG_DAYS,
                'validos_en_primera_pagina': len(rows), 'rechazados': rejected,
                'hay_mas_paginas': payload.get('exceededTransferLimit', False),
                'ultimo_evento_utc': max((r['ocurrido_en'] for r in rows), default=None)}, ensure_ascii=False))
        return
    if not settings.database_configured:
        raise RuntimeError('Configura SUPABASE_URL y SUPABASE_SECRET_KEY.')
    await database.open()
    try:
        worker = Ingestion()
        await worker.sync()
        print('Resultado de sincronización IGP:', worker.state)
        if worker.state not in ('actualizada', 'otra_ejecucion'):
            raise RuntimeError('La sincronización no terminó correctamente. Consulta Fuentes de datos.')
    finally:
        await database.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    try:
        asyncio.run(main(args.check_only))
    except Exception as exc:
        # Never print upstream request headers, configuration values or traceback.
        print(str(exc) if isinstance(exc, RuntimeError) else 'No se pudo completar la sincronización.', file=sys.stderr)
        sys.exit(1)
