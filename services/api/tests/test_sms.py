import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock,PropertyMock,patch
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import require_user
from app.services.sms import sms_provider,SmsProvider,TEMPLATE
from app.services.voice import voice_provider,VoiceError
from app.services.database import DatabaseError
from app.api.routes.auth import attempts

ACTOR='11111111-1111-4111-8111-111111111111'
REF='22222222-2222-4222-8222-222222222222'
PHONE='+51900000000'
DEST='a'*64
SID='SM'+'c'*32
HEADERS={'Origin':'http://localhost:5173'}
BODY={'destino_id':DEST,'confirmado':True}

class SmsApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        attempts.clear();self.actor={'id':ACTOR,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor)
        self.records=[];self.failure=None;self.claims=True;self.state='queued'
        async def db(method,table,**kwargs):
            self.records.append((table,kwargs))
            if self.failure:raise self.failure
            if table.endswith('sismocore_limites_sms'):return {'usadas_hoy':1,'usadas_total':1,'limite_diario':5,'limite_total':50,'espera_segundos':60}
            if table=='auditoria':
                if kwargs['params']['accion']=='eq.sms.solicitar':return [{'id':REF,'ocurrido_en':'2026-10-24T12:00:00Z','despues':{'ultimos':'0000'}}] if self.claims else []
                return [{'entidad_id':REF,'despues':{'estado':self.state,'proveedor_id':SID}}]
            return True
        self.patches=[patch('app.services.database.database.request',new=AsyncMock(side_effect=db)),
            patch.object(SmsProvider,'configured',new_callable=PropertyMock,return_value=True),
            patch.object(sms_provider,'recipients',new=AsyncMock(return_value={DEST:PHONE})),
            patch.object(sms_provider,'send_test',new=AsyncMock(return_value={'sid':SID,'estado':'queued'})),
            patch.object(sms_provider,'status',new=AsyncMock(return_value='delivered'))]
        self.mocks=[p.start() for p in self.patches]
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')
    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):p.stop()
        app.dependency_overrides.clear();attempts.clear()
    async def test_only_administration_reads_and_sends(self):
        with patch('app.services.audit.record',new=AsyncMock()):
            for role in ['operador','lectura','analista','auditor']:
                self.actor['rol']=role
                self.assertEqual((await self.client.get('/api/v1/sms/pruebas')).status_code,403)
                self.assertEqual((await self.client.post('/api/v1/sms/pruebas',json=BODY,headers=HEADERS)).status_code,403)
        self.mocks[3].assert_not_awaited()
    async def test_metadata_masks_phone_and_provider_id(self):
        response=await self.client.get('/api/v1/sms/pruebas')
        self.assertEqual(response.status_code,200)
        self.assertNotIn(PHONE,response.text);self.assertNotIn(SID,response.text)
        self.assertEqual(response.json()['destinatarios'][0]['id'],DEST)
    async def test_confirmed_request_reserves_before_send_and_no_body_input(self):
        response=await self.client.post('/api/v1/sms/pruebas',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,200);self.mocks[3].assert_awaited_once_with(PHONE)
        self.assertIn('sismocore_reservar_prueba_sms',self.records[0][0])
        self.assertEqual(self.records[0][1]['data']['p_actor'],ACTOR)
        response=await self.client.post('/api/v1/sms/pruebas',json={**BODY,'mensaje':'Arbitrario'},headers=HEADERS)
        self.assertEqual(response.status_code,422)
    async def test_unverified_destination_and_missing_confirmation_no_send(self):
        self.mocks[2].return_value={}
        response=await self.client.post('/api/v1/sms/pruebas',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,422)
        response=await self.client.post('/api/v1/sms/pruebas',json={**BODY,'confirmado':False},headers=HEADERS)
        self.assertEqual(response.status_code,422);self.mocks[3].assert_not_awaited()
    async def test_quota_failure_and_cross_origin_no_send(self):
        self.failure=DatabaseError(code='PT429')
        response=await self.client.post('/api/v1/sms/pruebas',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,429)
        response=await self.client.post('/api/v1/sms/pruebas',json=BODY,headers={'Origin':'https://evil.invalid'})
        self.assertEqual(response.status_code,403);self.mocks[3].assert_not_awaited()
    async def test_unknown_send_is_not_retried_and_recorded(self):
        self.mocks[3].side_effect=VoiceError('CONEXION')
        response=await self.client.post('/api/v1/sms/pruebas',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,503);self.mocks[3].assert_awaited_once()
        self.assertEqual(self.records[-1][1]['data']['p_estado'],'desconocida')

    async def test_trial_error_preserves_code_without_inventing_cause(self):
        self.mocks[3].side_effect=VoiceError('572003')
        response=await self.client.post('/api/v1/sms/pruebas',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,503)
        self.assertIn('572003',response.json()['detail'])
        self.mocks[3].assert_awaited_once()
    async def test_status_owned_and_no_duplicate_terminal_poll(self):
        response=await self.client.post(f'/api/v1/sms/pruebas/{REF}/actualizar',json={},headers=HEADERS)
        self.assertEqual(response.json()['estado'],'delivered')
        self.state='delivered';self.mocks[4].reset_mock()
        await self.client.post(f'/api/v1/sms/pruebas/{REF}/actualizar',json={},headers=HEADERS)
        self.mocks[4].assert_not_awaited()
        self.claims=False
        self.assertEqual((await self.client.post(f'/api/v1/sms/pruebas/{REF}/actualizar',json={},headers=HEADERS)).status_code,404)
        self.mocks[3].assert_not_awaited()

class SmsProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_trial_template_only_no_from_or_custom_message(self):
        with patch.object(voice_provider,'check_trial',new=AsyncMock()),patch.object(voice_provider,'request',new=AsyncMock(return_value={'sid':SID,'status':'queued'})) as request:
            await sms_provider.send_test(PHONE)
            request.assert_awaited_once_with('POST','/Messages.json',data={'To':PHONE,'Body':TEMPLATE})
    async def test_paid_account_blocked_before_send(self):
        with patch.object(voice_provider,'check_trial',new=AsyncMock(side_effect=VoiceError('CUENTA_NO_TRIAL'))),patch.object(voice_provider,'request',new=AsyncMock()) as request:
            with self.assertRaises(VoiceError):await sms_provider.send_test(PHONE)
            request.assert_not_awaited()
    async def test_incorrect_provider_response_is_unknown(self):
        with patch.object(voice_provider,'check_trial',new=AsyncMock()),patch.object(voice_provider,'request',new=AsyncMock(return_value={'sid':'bad','status':'queued'})):
            with self.assertRaises(VoiceError):await sms_provider.send_test(PHONE)
