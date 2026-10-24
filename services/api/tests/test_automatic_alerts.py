import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch
import httpx

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import require_user
from app.services.push import PushSender, PushError
from app.services.alerts import process_alerts
from app.services.database import DatabaseError
from app.api.routes.auth import attempts

USER='11111111-1111-4111-8111-111111111111'
TARGET='22222222-2222-4222-8222-222222222222'
ORIGIN={'Origin':'http://localhost:5173'}
BODY={'nombre':'Peru','magnitud_minima':4,'zona':None,'destinatarios':[USER],'activa':True}


class RuleApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.actor={'id':USER,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor)
        self.calls=[]
        self.error=None
        async def db(method,table,**kwargs):
            self.calls.append((table,kwargs))
            if self.error: raise self.error
            if table.endswith('sismocore_guardar_regla_alerta'): return {'id':TARGET,'token':'NEVER_EXPOSE'}
            return []
        self.mock=patch('app.services.database.database.request',new=AsyncMock(side_effect=db));self.mock.start()
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')
        attempts.clear()

    async def asyncTearDown(self):
        await self.client.aclose();self.mock.stop();app.dependency_overrides.clear();attempts.clear()

    async def test_only_administrator_and_operator_manage_rules(self):
        with patch('app.services.audit.record',new=AsyncMock()):
            for role in ['administrador','operador','analista','auditor','lectura']:
                self.actor['rol']=role
                response=await self.client.get('/api/v1/alertas/reglas')
                self.assertEqual(response.status_code,200 if role in ('administrador','operador') else 403)
                response=await self.client.post('/api/v1/alertas/reglas',headers=ORIGIN,json=BODY)
                self.assertEqual(response.status_code,200 if role in ('administrador','operador') else 403)

    async def test_create_uses_verified_actor_and_no_arbitrary_push_payload(self):
        response=await self.client.post('/api/v1/alertas/reglas',headers=ORIGIN,json=BODY)
        self.assertEqual(response.status_code,200)
        self.assertNotIn('NEVER_EXPOSE',response.text)
        data=self.calls[-1][1]['data']
        self.assertEqual(data['p_actor'],USER)
        self.assertEqual(data['p_destinatarios'],[USER])
        self.assertEqual(data['p_zona'],{})
        response=await self.client.post('/api/v1/alertas/reglas',headers=ORIGIN,json={**BODY,'p_actor':TARGET,'mensaje':'Falso'})
        self.assertEqual(response.status_code,422)

    async def test_invalid_ranges_and_empty_recipients_rejected(self):
        for change in [{'magnitud_minima':-1},{'destinatarios':[]},{'destinatarios':[USER,USER]},
            {'nombre':'   '},{'canales':['invalido']},{'canales':['voz','voz']},{'canales':[]},{'zona':{'latitud':91,'longitud':0,'radio_km':100}},
            {'zona':{'latitud':0,'longitud':0,'radio_km':0}}]:
            response=await self.client.post('/api/v1/alertas/reglas',headers=ORIGIN,json={**BODY,**change})
            self.assertEqual(response.status_code,422)
        self.assertFalse(self.calls)

    async def test_operator_cannot_create_voice_rule(self):
        self.actor['rol']='operador'
        with patch('app.services.audit.record',new=AsyncMock()):
            response=await self.client.post('/api/v1/alertas/reglas',headers=ORIGIN,json={**BODY,'canales':['push','voz']})
        self.assertEqual(response.status_code,403)
        self.assertFalse(self.calls)

    async def test_cross_origin_cannot_create_rules(self):
        response=await self.client.post('/api/v1/alertas/reglas',headers={'Origin':'https://evil.invalid'},json=BODY)
        self.assertEqual(response.status_code,403)
        self.assertFalse(self.calls)

    async def test_history_is_always_scoped_to_verified_user(self):
        self.actor['rol']='lectura'
        response=await self.client.get('/api/v1/alertas/historial?usuario_id='+TARGET)
        self.assertEqual(response.status_code,200)
        params=self.calls[-1][1]['params']
        self.assertEqual(params['usuario_id'],'eq.'+USER)
        self.assertNotIn('token',params['select'])

    async def test_conflicting_version_returns_actionable_error(self):
        self.error=DatabaseError(code='PT409')
        response=await self.client.patch('/api/v1/alertas/reglas/'+TARGET,headers=ORIGIN,json={**BODY,'version':1})
        self.assertEqual(response.status_code,409)
        self.assertIn('Actualiza',response.json()['detail'])

    async def test_only_managers_can_see_every_recipient(self):
        self.actor['rol']='lectura'
        response=await self.client.get('/api/v1/alertas/historial?alcance=todas')
        self.assertEqual(response.status_code,403)
        self.assertFalse(self.calls)
        self.actor['rol']='administrador'
        response=await self.client.get('/api/v1/alertas/historial?alcance=todas')
        self.assertEqual(response.status_code,200)
        self.assertNotIn('usuario_id',self.calls[-1][1]['params'])


class ProcessorTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        sms=patch('app.services.alerts.process_automatic_sms',new=AsyncMock(return_value={'estado':'apagadas','aceptadas':0}));sms.start();self.addCleanup(sms.stop)
        p=patch('app.services.alerts.process_automatic_calls',new=AsyncMock(return_value={'estado':'apagadas','aceptadas':0}))
        p.start();self.addCleanup(p.stop)

    async def test_claimed_messages_only_and_result_persisted_without_tokens(self):
        delivery={'id':TARGET,'reserva_id':USER,'token':'DEVICE_SECRET','evento_id':USER,'titulo':'Sismo reportado','mensaje':'Evento observado'}
        claim=0;records=[]
        async def db(method,table,**kwargs):
            nonlocal claim
            if table.endswith('sismocore_evaluar_reglas_push'): return 1
            if table.endswith('sismocore_reservar_envios_push'):
                claim+=1
                return [delivery] if claim==1 else []
            records.append(kwargs['data']);return True
        with patch.object(PushSender,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.alerts.database.request',new=AsyncMock(side_effect=db)),patch('app.services.alerts.push_sender.send',new=AsyncMock(return_value='provider-reference')) as send:
            result=await process_alerts()
        self.assertEqual(result['aceptadas'],1)
        self.assertEqual(result['fallidas'],0)
        send.assert_awaited_once()
        self.assertEqual(records[0]['p_reserva'],USER)
        self.assertNotIn('DEVICE_SECRET',str(records))

    async def test_unregistered_device_is_finalized_without_retry(self):
        calls=0
        async def db(method,table,**kwargs):
            nonlocal calls
            if table.endswith('sismocore_evaluar_reglas_push'): return 1
            if table.endswith('sismocore_reservar_envios_push'):
                calls+=1
                return [{'id':TARGET,'reserva_id':USER,'token':'secret','evento_id':USER,'titulo':'Reporte','mensaje':'Observado'}] if calls==1 else []
            self.assertEqual(kwargs['data']['p_codigo'],'UNREGISTERED');return True
        with patch.object(PushSender,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.alerts.database.request',new=AsyncMock(side_effect=db)),patch('app.services.alerts.push_sender.send',new=AsyncMock(side_effect=PushError('UNREGISTERED'))) as send:
            result=await process_alerts()
        self.assertEqual(result['fallidas'],1);send.assert_awaited_once()

    async def test_missing_worker_credential_fails_if_rules_are_active(self):
        with patch.object(PushSender,'configured',new_callable=PropertyMock,return_value=False),patch('app.services.alerts.database.request',new=AsyncMock(return_value=[{'id':TARGET}])):
            with self.assertRaisesRegex(RuntimeError,'notificaciones'): await process_alerts()

    async def test_paused_notifications_do_not_require_firebase(self):
        async def db(method,table,**kwargs):
            if table=='reglas_alerta':return [{'id':TARGET}]
            if table=='fuentes_datos':return [{'limites':{'push_habilitado':False}}]
            raise AssertionError('Intento reservar envios mientras estaban pausados')
        with patch.object(PushSender,'configured',new_callable=PropertyMock,return_value=False),patch('app.services.alerts.database.request',new=AsyncMock(side_effect=db)):
            result=await process_alerts()
        self.assertEqual(result['estado'],'pausadas')
