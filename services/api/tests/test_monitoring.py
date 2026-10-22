import copy
import asyncio
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.services.ingestion import Ingestion, normalize
from app.services.database import DatabaseError
from main import app
from app.services.auth import require_user

CLIENT = httpx.AsyncClient


def feature(**overrides):
    attributes = {
        'code': '2026-1', 'fechaevento': 1792552368000,
        'lat': -12, 'lon': -77, 'prof': 20, 'magnitud': 4.5,
        'ref': 'Prueba, Perú', 'departamento': 'Lima',
    }
    attributes.update(overrides)
    return {'attributes': attributes}


class NormalizationTests(unittest.TestCase):
    def test_valid_coordinates_and_provenance(self):
        row = normalize(feature())
        self.assertEqual((row['latitud'], row['longitud'], row['profundidad']), (-12, -77, 20))
        self.assertEqual(row['id_externo'], '2026-1')
        self.assertEqual(row['ocurrido_en'], '2026-10-21T03:12:48+00:00')
        self.assertIn('ide.igp.gob.pe', row['url_fuente'])
        self.assertIsNone(row['tipo_magnitud'])
        self.assertIsNone(row['actualizado_fuente_en'])
        self.assertEqual(len(row['hash_origen']), 64)

    def test_invalid_coordinates_rejected(self):
        for values in [{'lat': None}, {'lon': 999}, {'lat': -99}, {'prof': None}, {'lat': True}]:
            with self.subTest(values=values), self.assertRaises(ValueError):
                normalize(feature(**values))

    def test_missing_provenance_rejected(self):
        for code in [None, '', 'invalid', "2026-1' OR 1=1"]:
            with self.subTest(code=code), self.assertRaises(ValueError):
                normalize(feature(code=code))

    def test_missing_magnitude_is_valid(self):
        self.assertIsNone(normalize(feature(magnitud=None))['magnitud'])

    def test_nonfinite_magnitude_rejected(self):
        for value in [float('nan'), float('inf'), -float('inf'), True, -1, 11]:
            with self.subTest(value=value), self.assertRaises(ValueError):
                normalize(feature(magnitud=value))

    def test_hash_changes_only_with_source_values(self):
        first = normalize(feature())
        self.assertEqual(first['hash_origen'], normalize(feature())['hash_origen'])
        self.assertNotEqual(first['hash_origen'], normalize(feature(magnitud=5))['hash_origen'])


class MemoryDatabase:
    """Simulates only data operations; no network or real credentials are used."""
    def __init__(self):
        self.events = {}
        self.runs = {}

    async def request(self, method, table, *, params=None, data=None, prefer=None):
        if table == 'fuentes_datos':
            return [{'id': 'source', 'activa': True, 'parametros': {}}] if method == 'GET' else []
        if table == 'ejecuciones_ingesta':
            if method == 'POST':
                self.runs[data['id']] = copy.deepcopy(data)
            elif method == 'PATCH' and params.get('id'):
                self.runs[params['id'][3:]].update(data)
            return []
        if table == 'eventos_sismicos':
            if method == 'GET':
                return list(self.events.values())
            for row in data:
                self.events[row['id_externo']] = copy.deepcopy(row)
            return []
        raise AssertionError('Unexpected table')


class IngestionTests(unittest.IsolatedAsyncioTestCase):
    async def test_repeated_sync_is_idempotent_and_preserves_receipt(self):
        db = MemoryDatabase()
        response = {'features': [feature()]}
        transport = httpx.MockTransport(lambda _: httpx.Response(200, json=response))
        with patch('app.services.ingestion.database', db), patch(
            'app.services.ingestion.httpx.AsyncClient', side_effect=lambda **kw: CLIENT(transport=transport, **kw)
        ):
            worker = Ingestion()
            await worker.sync()
            original = copy.deepcopy(db.events['2026-1'])
            await worker.sync()
            self.assertEqual(len(db.events), 1)
            self.assertEqual(db.events['2026-1']['id'], original['id'])
            self.assertEqual(db.events['2026-1']['recibido_en'], original['recibido_en'])
            self.assertEqual(list(db.runs.values())[-1]['registros_sin_cambios'], 1)
            response['features'][0]['attributes']['magnitud'] = 5
            await worker.sync()
            self.assertEqual(db.events['2026-1']['magnitud'], 5)
            self.assertEqual(db.events['2026-1']['id'], original['id'])
            self.assertEqual(db.events['2026-1']['recibido_en'], original['recibido_en'])
            self.assertEqual(list(db.runs.values())[-1]['registros_actualizados'], 1)

    async def test_upstream_failure_is_recorded(self):
        db = MemoryDatabase()
        transport = httpx.MockTransport(lambda _: httpx.Response(503))
        with patch('app.services.ingestion.database', db), patch(
            'app.services.ingestion.httpx.AsyncClient', side_effect=lambda **kw: CLIENT(transport=transport, **kw)
        ):
            worker = Ingestion()
            await worker.sync()
        self.assertEqual(worker.state, 'error')
        self.assertEqual(list(db.runs.values())[-1]['estado'], 'fallida')
        self.assertFalse(db.events)

    async def test_shutdown_releases_active_ingestion(self):
        db = MemoryDatabase()
        async def cancelled(request):
            raise asyncio.CancelledError()
        transport = httpx.MockTransport(cancelled)
        with patch('app.services.ingestion.database', db), patch(
            'app.services.ingestion.httpx.AsyncClient', side_effect=lambda **kw: CLIENT(transport=transport, **kw)
        ):
            with self.assertRaises(asyncio.CancelledError):
                await Ingestion().sync()
        self.assertEqual(list(db.runs.values())[-1]['estado'], 'cancelada')


class APITests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        app.dependency_overrides[require_user] = lambda: {'id': 'test-user', 'rol': 'lectura'}

    async def asyncTearDown(self):
        app.dependency_overrides.clear()

    async def test_health_checks_database(self):
        with patch('app.api.routes.health.database.request', side_effect=DatabaseError()):
            async with CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['base_datos'], 'desconectada')

    async def test_database_failure_returns_safe_503(self):
        with patch('app.api.routes.eventos.catalog.read', side_effect=DatabaseError(401)):
            async with CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.get('/api/v1/eventos/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(set(response.json()), {'detail'})

    async def test_catalog_route_does_not_fetch_usgs(self):
        with patch('app.api.routes.eventos.catalog.read', return_value={'total': 0, 'eventos': []}):
            async with CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                response = await client.get('/api/v1/eventos/', headers={'Origin': 'http://localhost:5173'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:5173')

    async def test_catalog_accepts_both_paths_without_redirects(self):
        with patch('app.api.routes.eventos.catalog.read', return_value={'total': 0, 'eventos': []}):
            async with CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                for path in ['/api/v1/eventos', '/api/v1/eventos/']:
                    with self.subTest(path=path):
                        response = await client.get(path)
                        self.assertEqual(response.status_code, 200)
                        self.assertNotIn('location', response.headers)
                        self.assertEqual(response.json(), {'total': 0, 'eventos': []})

    async def test_both_catalog_paths_require_authentication(self):
        app.dependency_overrides.clear()
        async with CLIENT(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            for path in ['/api/v1/eventos', '/api/v1/eventos/']:
                with self.subTest(path=path):
                    response = await client.get(path)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.headers['content-type'], 'application/json')


if __name__ == '__main__':
    unittest.main()
