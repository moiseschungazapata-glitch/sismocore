import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock,PropertyMock,patch
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import require_user
from app.services.sms import sms_provider,SmsProvider
from app.services.voice import VoiceError
from app.services.automatic_sms import process_automatic_sms
from app.services.alerts import process_alerts
from app.api.routes.auth import attempts

ACTOR='11111111-1111-4111-8111-111111111111'
REF='22222222-2222-4222-8222-222222222222'
DEST='a'*64
HEADERS={'Origin':'http://localhost:5173'}

class AutomaticSmsWorkerTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.flags={'sms_habilitada':True,'sms_cuenta':sms_provider.account_hash};self.valid=True
        self.claim={'id':ACTOR,'reserva_id':REF,'destino':DEST};self.records=[]
        async def db(method,table,**kwargs):
            self.records.append((table,kwargs))
            if table=='fuentes_datos':return [{'limites':self.flags}]
            if table=='entregas_alerta':return []
            if table.endswith('sismocore_reservar_sms_automatico'):return self.claim
            if table.endswith('sismocore_validar_envio_sms'):return self.valid
            return True
        self.patches=[patch('app.services.database.database.request',new=AsyncMock(side_effect=db)),
            patch.object(SmsProvider,'configured',new_callable=PropertyMock,return_value=True),
            patch.object(sms_provider,'recipients',new=AsyncMock(return_value={DEST:'+51900000000'})),
            patch.object(sms_provider,'send_test',new=AsyncMock(return_value={'sid':'SM'+'c'*32,'estado':'queued'}))]
        self.mocks=[p.start() for p in self.patches]
    async def asyncTearDown(self):
        for p in reversed(self.patches):p.stop()
    async def test_off_never_contacts_twilio(self):
        self.flags={};self.assertEqual((await process_automatic_sms())['estado'],'apagadas')
        self.mocks[2].assert_not_awaited();self.mocks[3].assert_not_awaited()
    async def test_account_mismatch_never_contacts_twilio(self):
        self.flags['sms_cuenta']='different'
        with self.assertRaises(RuntimeError):await process_automatic_sms()
        self.mocks[2].assert_not_awaited()
    async def test_single_claim_sends_only_one_template(self):
        self.assertEqual((await process_automatic_sms())['aceptadas'],1)
        self.mocks[3].assert_awaited_once_with('+51900000000')
        self.assertEqual(self.records[-1][1]['data']['p_reserva'],REF)
    async def test_consent_revocation_prevents_send(self):
        self.valid=False;await process_automatic_sms();self.mocks[3].assert_not_awaited()
    async def test_no_claim_no_send(self):
        self.claim=None;await process_automatic_sms();self.mocks[3].assert_not_awaited()
    async def test_unknown_result_no_retry(self):
        self.mocks[3].side_effect=VoiceError('CONEXION')
        self.assertEqual((await process_automatic_sms())['estado'],'desconocida');self.mocks[3].assert_awaited_once()
    async def test_unavailable_phone_no_send(self):
        self.mocks[2].return_value={};await process_automatic_sms();self.mocks[3].assert_not_awaited()

class AutomaticSmsApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.actor={'id':ACTOR,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor);attempts.clear()
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')
    async def asyncTearDown(self):
        await self.client.aclose();app.dependency_overrides.clear();attempts.clear()
    async def test_requires_explicit_trial_demo_confirmation(self):
        for path,body in [('automaticos',{'activa':True,'confirmado':True}),('telefono',{'destino_id':DEST,'confirmado':True})]:
            response=await self.client.post('/api/v1/sms/'+path,json=body,headers=HEADERS)
            self.assertEqual(response.status_code,422)
    async def test_non_admin_cannot_authorize_or_enable(self):
        with patch('app.services.audit.record',new=AsyncMock()):
            for role in ['lectura','operador','analista','auditor']:
                self.actor['rol']=role
                response=await self.client.post('/api/v1/sms/automaticos',json={'activa':True,'confirmado':True,'demostracion_trial':True},headers=HEADERS)
                self.assertEqual(response.status_code,403)
    async def test_pause_does_not_contact_provider(self):
        with patch('app.services.database.database.request',new=AsyncMock(return_value=True)),patch('app.services.voice.voice_provider.check_trial',new=AsyncMock()) as provider:
            response=await self.client.post('/api/v1/sms/automaticos',json={'activa':False,'confirmado':True,'demostracion_trial':True},headers=HEADERS)
            self.assertEqual(response.status_code,200);provider.assert_not_awaited()
    async def test_enable_requires_authorized_phone(self):
        with patch('app.services.database.database.request',new=AsyncMock(return_value=[])),patch('app.services.voice.voice_provider.check_trial',new=AsyncMock()):
            response=await self.client.post('/api/v1/sms/automaticos',json={'activa':True,'confirmado':True,'demostracion_trial':True},headers=HEADERS)
            self.assertEqual(response.status_code,422)

class SmsChannelIndependenceTests(unittest.IsolatedAsyncioTestCase):
    async def test_sms_attempted_even_if_other_channels_fail(self):
        with patch('app.services.alerts.process_push_alerts',new=AsyncMock(side_effect=RuntimeError())),patch('app.services.alerts.process_automatic_calls',new=AsyncMock(side_effect=RuntimeError())),patch('app.services.alerts.process_automatic_sms',new=AsyncMock(return_value={'estado':'apagadas'})) as sms:
            with self.assertRaises(RuntimeError):await process_alerts()
            sms.assert_awaited_once()
