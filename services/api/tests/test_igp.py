import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import httpx

from app.services.igp import query_params
from app.services.ingestion import Ingestion
from app.services.catalog import Catalog
from test_monitoring import MemoryDatabase, feature, CLIENT


class IGPTests(unittest.IsolatedAsyncioTestCase):
    def test_query_uses_peru_time_for_sql_and_stable_pagination(self):
        params = query_params(30, datetime(2026, 10, 22, 2, tzinfo=timezone.utc))
        self.assertIn("2026-09-21 21:00:00", params['where'])
        self.assertIn("2026-10-21 21:00:00", params['where'])
        self.assertEqual(params['orderByFields'], 'fechaevento ASC,objectid ASC')

    async def test_pagination_imports_all_records_and_counts_invalid_rows(self):
        db = MemoryDatabase()
        offsets = []
        def upstream(request):
            offset = int(request.url.params['resultOffset'])
            offsets.append(offset)
            payload = {'features': [feature(), feature(code=None)], 'exceededTransferLimit': True} if offset == 0 else {
                'features': [feature(code='2026-2')], 'exceededTransferLimit': False}
            return httpx.Response(200, json=payload)
        with patch('app.services.ingestion.database', db), patch(
            'app.services.ingestion.httpx.AsyncClient', side_effect=lambda **kw: CLIENT(transport=httpx.MockTransport(upstream), **kw)
        ):
            worker = Ingestion()
            await worker.sync()
        self.assertEqual(worker.state, 'actualizada')
        self.assertEqual(offsets, [0, 2])
        self.assertEqual(set(db.events), {'2026-1', '2026-2'})
        run = list(db.runs.values())[-1]
        self.assertEqual(run['registros_recibidos'], 3)
        self.assertEqual(run['registros_rechazados'], 1)

    async def test_arcgis_error_with_http_200_is_not_a_successful_sync(self):
        db = MemoryDatabase()
        with patch('app.services.ingestion.database', db), patch(
            'app.services.ingestion.httpx.AsyncClient', side_effect=lambda **kw: CLIENT(
                transport=httpx.MockTransport(lambda _: httpx.Response(200, json={'error': {'code': 400}})), **kw)
        ):
            worker = Ingestion()
            await worker.sync()
        self.assertEqual(worker.state, 'error')
        self.assertEqual(list(db.runs.values())[-1]['estado'], 'fallida')
        self.assertFalse(db.events)

    async def test_new_igp_source_is_registered_without_overwriting_existing_sources(self):
        calls = []
        async def db(method, table, **kw):
            calls.append((method, table, kw))
            if table == 'fuentes_datos' and method == 'GET':
                return [] if len(calls) == 1 else [{'id': 'new-source', 'activa': False}]
            return []
        with patch('app.services.ingestion.database.request', new=AsyncMock(side_effect=db)):
            worker = Ingestion()
            await worker.sync()
        self.assertEqual(worker.state, 'inactiva')
        post = calls[1]
        self.assertEqual(post[2]['data']['codigo'], 'igp')
        self.assertIn('ignore-duplicates', post[2]['prefer'])
        self.assertFalse(any(table == 'eventos_sismicos' for _, table, _ in calls))

    async def test_catalog_isolates_igp_events_and_execution_history(self):
        calls = []
        async def db(method, table, **kw):
            calls.append((table, kw['params']))
            if table == 'fuentes_datos':
                return [{'id': 'igp-source'}]
            return []
        with patch('app.services.catalog.database.request', new=AsyncMock(side_effect=db)):
            result = await Catalog().read()
        self.assertEqual(result['codigo_fuente'], 'igp')
        self.assertEqual(result['periodo_dias'], 30)
        self.assertEqual(result['frecuencia_segundos'], 300)
        for table, params in calls:
            if table != 'fuentes_datos':
                self.assertEqual(params['fuente_id'], 'eq.igp-source')

    async def test_missing_igp_source_does_not_return_legacy_catalog(self):
        database = AsyncMock(return_value=[])
        with patch('app.services.catalog.database.request', new=database):
            result = await Catalog().read()
        self.assertEqual(result['total'], 0)
        self.assertIsNone(result['ultima_ejecucion'])
        self.assertEqual(database.await_count, 1)
