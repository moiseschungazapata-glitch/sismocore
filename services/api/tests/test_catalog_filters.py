import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
from pydantic import ValidationError
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.services.catalog_filters import CatalogFilters
from app.services.auth import require_user
from main import app

EVENT={'id':'11111111-1111-4111-8111-111111111111','id_externo':'2026-1','lugar':'Lima','region':'LIMA','magnitud':4.5,'profundidad':30,'latitud':-12,'longitud':-77,'ocurrido_en':'2026-10-24T12:00:00Z'}

class CatalogFilterTests(unittest.TestCase):
    def test_combined_bounds_and_missing_values(self):
        f=CatalogFilters(mag_min=4.5,mag_max=4.5,prof_min=30,prof_max=30,region='LIMA',desde='2026-10-24',hasta='2026-10-24')
        self.assertTrue(f.matches(EVENT))
        self.assertFalse(f.matches({**EVENT,'magnitud':None}))
        self.assertFalse(f.matches({**EVENT,'region':'TUMBES'}))
        self.assertFalse(f.matches({**EVENT,'profundidad':30.01}))

    def test_circle_polygon_intersection_and_edges(self):
        points=[(-13,-78),(-11,-78),(-11,-76),(-13,-76)]
        f=CatalogFilters(lat=-12,lon=-77,radio=1,poligono=points)
        self.assertTrue(f.matches(EVENT))
        self.assertFalse(f.matches({**EVENT,'latitud':-12.1}))
        self.assertTrue(CatalogFilters(poligono=points).matches({**EVENT,'latitud':-13,'longitud':-78}))
        self.assertFalse(CatalogFilters(poligono=points).matches({**EVENT,'latitud':-10}))

    def test_invalid_ranges_and_geography(self):
        for values in [{'mag_min':6,'mag_max':4},{'prof_min':-1},{'lat':-12},{'radio':3000},{'poligono':[[99,0],[0,0],[1,1]]},{'mag_min':float('nan')}]:
            with self.assertRaises(ValidationError): CatalogFilters(**values)

class CatalogEndpointTests(unittest.IsolatedAsyncioTestCase):
    async def test_api_pagination_detail_and_filters_match_export(self):
        app.dependency_overrides[require_user]=lambda:{'id':EVENT['id'],'rol':'analista','estado':'activo','nombre_completo':'Prueba','email':'test@example.invalid'}
        events=[EVENT,{**EVENT,'id':'22222222-2222-4222-8222-222222222222','magnitud':6}, {**EVENT,'id':'33333333-3333-4333-8333-333333333333','magnitud':None}]
        snapshot={'eventos':events,'total':3,'fuente':'IGP','consultado_en':'2026-10-24T13:00:00Z','ultima_sincronizacion':None,'periodo_dias':30}
        try:
            with patch('app.services.catalog.catalog.read',new=AsyncMock(return_value=snapshot)),patch('app.services.audit.record',new=AsyncMock()):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost') as client:
                    response=await client.get('/api/v1/eventos?mag_min=4&mag_max=5&region=LIMA&pagina=1&tamano=1')
                    self.assertEqual(response.status_code,200)
                    self.assertEqual(response.json()['total'],1)
                    exported=await client.post('/api/v1/reportes/exportar',json={'mag_min':4,'mag_max':5,'region':'LIMA'},headers={'Origin':'http://localhost:5173'})
                    self.assertEqual(exported.status_code,200)
                    self.assertEqual(response.json()['eventos'],exported.json()['eventos'])
                    detail=await client.get('/api/v1/eventos/'+EVENT['id'])
                    self.assertEqual(detail.json()['evento'],EVENT)
                    self.assertEqual((await client.get('/api/v1/eventos?mag_min=6&mag_max=4')).status_code,422)
                    ordered=(await client.get('/api/v1/eventos?orden=magnitud_asc')).json()['eventos']
                    self.assertIsNone(ordered[-1]['magnitud'])
        finally: app.dependency_overrides.clear()
