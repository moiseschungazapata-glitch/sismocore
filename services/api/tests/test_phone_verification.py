import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock,PropertyMock,patch
import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import require_user
from app.services.voice import voice_provider,VoiceError
from app.services.database import DatabaseError
from app.core.config import settings
from app.api.routes.auth import attempts

ACTOR='11111111-1111-4111-8111-111111111111'
REF='22222222-2222-4222-8222-222222222222'
PHONE='+51900000000'
SID='CA'+'c'*32
BODY={'telefono':PHONE,'confirmado':True,'consentimiento':True}
HEADERS={'Origin':'http://localhost:5173'}

class VerificationApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.actor={'id':ACTOR,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor);attempts.clear()
        self.records=[];self.failure=None;self.foreign=False
        async def db(method,table,**kwargs):
            self.records.append((table,kwargs))
            if self.failure:raise self.failure
            if table=='auditoria':return [] if self.foreign else [{'despues':{'destino':voice_provider.recipient_id(PHONE),'ultimos':'0000'}}]
            return True
        self.patches=[patch('app.services.database.database.request',new=AsyncMock(side_effect=db)),
            patch.object(voice_provider,'recipients',new=AsyncMock(return_value={})),
            patch.object(voice_provider,'verify_phone',new=AsyncMock(return_value={'codigo':'123456','sid':SID}))]
        self.mocks=[p.start() for p in self.patches]
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')
    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):p.stop()
        app.dependency_overrides.clear();attempts.clear()
    async def test_shows_code_without_storing_number_or_code(self):
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,200);self.assertEqual(response.json()['codigo'],'123456')
        self.assertNotIn(PHONE,str(self.records));self.assertNotIn('123456',str(self.records))
        self.mocks[2].assert_awaited_once_with(PHONE)
    async def test_already_verified_never_calls_or_reserves(self):
        self.mocks[1].return_value={voice_provider.recipient_id(PHONE):PHONE}
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
        self.assertTrue(response.json()['verificado']);self.mocks[2].assert_not_awaited();self.assertFalse(self.records)
    async def test_no_confirmation_consent_or_valid_phone_no_call(self):
        for data in [{**BODY,'confirmado':False},{**BODY,'consentimiento':False},{**BODY,'telefono':'+51000000000'},{'telefono':PHONE}]:
            response=await self.client.post('/api/v1/voz/verificaciones',json=data,headers=HEADERS)
            self.assertEqual(response.status_code,422)
        self.mocks[2].assert_not_awaited()
    async def test_other_roles_denied(self):
        with patch('app.services.audit.record',new=AsyncMock()):
            for role in ['lectura','operador','auditor','analista']:
                self.actor['rol']=role
                response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
                self.assertEqual(response.status_code,403)
        self.mocks[2].assert_not_awaited()
    async def test_quota_failure_never_calls(self):
        self.failure=DatabaseError(code='PT429')
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,429);self.mocks[2].assert_not_awaited()
    async def test_trial_rejection_is_actionable_without_retry(self):
        self.mocks[2].side_effect=VoiceError('20008')
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,503);self.assertIn('Try out Voice',response.json()['detail'])
        self.mocks[2].assert_awaited_once()

    async def test_10002_reports_confirmed_trial_restriction(self):
        self.mocks[2].side_effect=VoiceError('10002')
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,503)
        self.assertIn('no permite verificar números por API (10002)',response.json()['detail'])
        self.assertIn('Actualizar llamadas',response.json()['detail'])
        self.mocks[2].assert_awaited_once()
    async def test_unknown_result_does_not_retry(self):
        self.mocks[2].side_effect=VoiceError('CONEXION')
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers=HEADERS)
        self.assertEqual(response.status_code,503);self.assertIn('no la repitas',response.json()['detail'])
        self.mocks[2].assert_awaited_once()
    async def test_status_requires_own_claim_and_does_not_call(self):
        self.foreign=True
        response=await self.client.get('/api/v1/voz/verificaciones/'+REF)
        self.assertEqual(response.status_code,404);self.mocks[2].assert_not_awaited()
        self.foreign=False;self.mocks[1].return_value={voice_provider.recipient_id(PHONE):PHONE}
        response=await self.client.get('/api/v1/voz/verificaciones/'+REF)
        self.assertTrue(response.json()['verificado']);self.mocks[2].assert_not_awaited()
        params=self.records[-1][1]['params'];self.assertEqual(params['actor_id'],'eq.'+ACTOR)
    async def test_cross_origin_no_call(self):
        response=await self.client.post('/api/v1/voz/verificaciones',json=BODY,headers={'Origin':'https://evil.invalid'})
        self.assertEqual(response.status_code,403);self.mocks[2].assert_not_awaited()

class VerificationProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_minimal_official_request_and_response_validation(self):
        payload={'account_sid':'AC'+'a'*32,'phone_number':PHONE,'validation_code':'123456','call_sid':SID}
        with patch.object(settings,'TWILIO_ACCOUNT_SID',payload['account_sid']),patch.object(voice_provider,'check_trial',new=AsyncMock()),patch.object(voice_provider,'request',new=AsyncMock(return_value=payload)) as request:
            result=await voice_provider.verify_phone(PHONE)
            self.assertEqual(result,{'codigo':'123456','sid':SID})
            request.assert_awaited_once_with('POST','/OutgoingCallerIds.json',data={'PhoneNumber':PHONE})
            payload['validation_code']='invalid'
            with self.assertRaises(VoiceError):await voice_provider.verify_phone(PHONE)
