import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.core.config import settings
from app.services.scheduled import synchronize

TOKEN='a'*64


class CronApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost')
        self.config=patch.object(settings,'SYNC_CRON_SECRET',TOKEN);self.config.start()
        self.configured=patch.object(settings,'SUPABASE_URL','https://example.supabase.co');self.configured.start()
        self.secret=patch.object(settings,'SUPABASE_SECRET_KEY','test-private');self.secret.start()
        self.work=patch('app.api.routes.internal.synchronize',new=AsyncMock(return_value={'estado':'completada'}))
        self.worker=self.work.start()

    async def asyncTearDown(self):
        await self.client.aclose()
        self.work.stop();self.config.stop();self.configured.stop();self.secret.stop()

    async def test_requires_private_header_even_with_cookie_or_query(self):
        for headers,url in [({},''),({'Authorization':'Bearer wrong'},''),({'Cookie':'sismocore_access='+TOKEN},''),({},'?token='+TOKEN)]:
            response=await self.client.post('/api/v1/interno/sincronizacion'+url,headers=headers)
            self.assertEqual(response.status_code,401)
        self.worker.assert_not_awaited()
        with patch.object(settings,'SYNC_CRON_SECRET',''):
            self.assertEqual((await self.client.post('/api/v1/interno/sincronizacion',headers={'Authorization':'Bearer '})).status_code,401)

    async def test_post_runs_once_and_does_not_echo_failures(self):
        response=await self.client.post('/api/v1/interno/sincronizacion',headers={'Authorization':'Bearer '+TOKEN})
        self.assertEqual(response.status_code,200);self.worker.assert_awaited_once()
        self.worker.side_effect=RuntimeError('private-secret-in-upstream-error')
        response=await self.client.post('/api/v1/interno/sincronizacion',headers={'Authorization':'Bearer '+TOKEN})
        self.assertEqual(response.status_code,503);self.assertNotIn('private-secret',response.text)
        self.assertEqual(response.headers['cache-control'],'no-store')

    async def test_readiness_never_runs_ingestion_or_sends(self):
        async def query(method,table,**kw):
            if table.endswith('estado_sincronizacion'):return {'activo':False}
            if table=='fuentes_datos':return [{'activa':True,'limites':{}}]
            return []
        with patch('app.api.routes.internal.database.request',new=AsyncMock(side_effect=query)):
            response=await self.client.get('/api/v1/interno/sincronizacion',headers={'Authorization':'Bearer '+TOKEN})
        self.assertTrue(response.json()['listo']);self.assertEqual(response.json()['version'],'supabase-cron-v1')
        self.worker.assert_not_awaited()


class CronWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def test_busy_lease_does_not_sync_or_send(self):
        worker=AsyncMock()
        with patch('app.services.scheduled.database.request',new=AsyncMock(return_value=False)),patch('app.services.scheduled.process_alerts',new=AsyncMock()) as send:
            result=await synchronize(worker)
        self.assertEqual(result['estado'],'omitida');worker.sync.assert_not_awaited();send.assert_not_awaited()

    async def test_success_and_failure_release_only_own_lease(self):
        for failure in [False,True]:
            worker=AsyncMock();worker.state='actualizada'
            rpc=AsyncMock(return_value=True)
            send=AsyncMock(side_effect=RuntimeError() if failure else None,return_value={'aceptadas':0})
            with patch('app.services.scheduled.database.request',new=rpc),patch('app.services.scheduled.process_alerts',new=send):
                if failure:
                    with self.assertRaises(RuntimeError):await synchronize(worker)
                else:self.assertEqual((await synchronize(worker))['estado'],'completada')
            calls=rpc.await_args_list
            self.assertEqual(calls[0].kwargs['data']['p_reserva'],calls[-1].kwargs['data']['p_reserva'])
            self.assertEqual(calls[-1].kwargs['data']['p_estado'],'fallida' if failure else 'completada')

    async def test_external_ingestion_contention_never_evaluates_alerts(self):
        worker=AsyncMock();worker.state='otra_ejecucion'
        with patch('app.services.scheduled.database.request',new=AsyncMock(return_value=True)),patch('app.services.scheduled.process_alerts',new=AsyncMock()) as send:
            self.assertEqual((await synchronize(worker))['estado'],'omitida')
            send.assert_not_awaited()
