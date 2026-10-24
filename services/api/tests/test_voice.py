import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch
from xml.etree import ElementTree
import httpx

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import require_user
from app.services.voice import voice_provider, VoiceProvider, VoiceError
from app.services.database import DatabaseError
from app.core.config import settings
from app.api.routes.auth import attempts

ACTOR='11111111-1111-4111-8111-111111111111'
REF='22222222-2222-4222-8222-222222222222'
PHONE='+51900000000'
DEST='a'*64
SID='CA'+'c'*32
ORIGIN={'Origin':'http://localhost:5173'}


class VoiceApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        attempts.clear()
        self.actor={'id':ACTOR,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor)
        self.calls=[];self.error=None
        async def db(method,table,**kwargs):
            self.calls.append((table,kwargs))
            if self.error: raise self.error
            if table.endswith('sismocore_limites_voz') or table.endswith('sismocore_reservar_prueba_voz'):
                return {'usadas_hoy':1,'usadas_total':1,'limite_diario':5,'limite_total':50,'espera_segundos':60}
            if table=='auditoria':
                if kwargs['params']['accion']=='eq.voz.solicitar': return [{'id':REF,'ocurrido_en':'2026-10-24T12:00:00Z','despues':{'ultimos':'0000'}}]
                return [{'entidad_id':REF,'despues':{'estado':'queued','proveedor_id':SID}}]
            return True
        self.patches=[patch('app.services.database.database.request',new=AsyncMock(side_effect=db)),
            patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),
            patch.object(voice_provider,'recipients',new=AsyncMock(return_value={DEST:PHONE})),
            patch.object(voice_provider,'call',new=AsyncMock(return_value={'sid':SID,'estado':'queued'})),
            patch.object(voice_provider,'status',new=AsyncMock(return_value='completed'))]
        self.mocks=[p.start() for p in self.patches]
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')

    async def asyncTearDown(self):
        await self.client.aclose()
        for p in reversed(self.patches):p.stop()
        app.dependency_overrides.clear();attempts.clear()

    async def test_non_admin_roles_cannot_read_or_call(self):
        with patch('app.services.audit.record',new=AsyncMock()):
            for role in ['operador','analista','auditor','lectura']:
                self.actor['rol']=role
                response=await self.client.get('/api/v1/voz/pruebas')
                self.assertEqual(response.status_code,403)
                response=await self.client.post('/api/v1/voz/pruebas',headers=ORIGIN,json={'destino_id':DEST,'confirmado':True})
                self.assertEqual(response.status_code,403)
        self.mocks[3].assert_not_awaited()

    async def test_public_xml_is_fixed_and_does_not_call(self):
        app.dependency_overrides.clear()
        for method in ['GET','POST']:
            response=await self.client.request(method,'/api/v1/voz/prueba.xml?mensaje=UNTRUSTED')
            self.assertEqual(response.status_code,200)
            root=ElementTree.fromstring(response.content)
            self.assertEqual(root.find('Say').get('language'),'es')
            self.assertNotIn('UNTRUSTED',response.text)
            self.assertIsNotNone(root.find('Hangup'))
        self.mocks[3].assert_not_awaited()

    async def test_config_masks_phone_and_provider_sid(self):
        response=await self.client.get('/api/v1/voz/pruebas')
        self.assertEqual(response.status_code,200)
        self.assertNotIn(PHONE,response.text)
        self.assertNotIn(SID,response.text)
        self.assertFalse(response.json()['automaticas'])

    async def test_requires_confirmation_origin_and_known_recipient(self):
        for body in [{'destino_id':DEST},{'destino_id':DEST,'confirmado':False},{'destino_id':DEST,'confirmado':True,'telefono':PHONE}]:
            response=await self.client.post('/api/v1/voz/pruebas',headers=ORIGIN,json=body)
            self.assertEqual(response.status_code,422)
            self.assertNotIn(PHONE,response.text)
        response=await self.client.post('/api/v1/voz/pruebas',headers={'Origin':'https://evil.invalid'},json={'destino_id':DEST,'confirmado':True})
        self.assertEqual(response.status_code,403)
        response=await self.client.post('/api/v1/voz/pruebas',headers=ORIGIN,json={'destino_id':'f'*64,'confirmado':True})
        self.assertEqual(response.status_code,422)
        self.mocks[3].assert_not_awaited()

    async def test_limits_block_before_provider_call(self):
        for code,status in [('PT429',429),('PT409',409)]:
            self.error=DatabaseError(code=code)
            response=await self.client.post('/api/v1/voz/pruebas',headers=ORIGIN,json={'destino_id':DEST,'confirmado':True})
            self.assertEqual(response.status_code,status)
        self.mocks[3].assert_not_awaited()

    async def test_accepted_call_reserved_first_and_identity_verified(self):
        response=await self.client.post('/api/v1/voz/pruebas',headers=ORIGIN,json={'destino_id':DEST,'confirmado':True})
        self.assertEqual(response.status_code,200)
        self.assertNotIn(PHONE,response.text)
        self.assertNotIn(SID,response.text)
        self.assertEqual(response.json()['estado'],'queued')
        self.assertEqual(self.calls[0][0],'rpc/sismocore_reservar_prueba_voz')
        self.assertEqual(self.calls[0][1]['data']['p_actor'],ACTOR)
        self.mocks[3].assert_awaited_once_with(PHONE)

    async def test_timeout_is_recorded_without_retry_or_delivery_claim(self):
        self.mocks[3].side_effect=VoiceError('CONEXION')
        response=await self.client.post('/api/v1/voz/pruebas',headers=ORIGIN,json={'destino_id':DEST,'confirmado':True})
        self.assertEqual(response.status_code,503)
        self.assertEqual(self.calls[-1][1]['data']['p_estado'],'desconocida')
        self.mocks[3].assert_awaited_once()

    async def test_status_cannot_query_another_users_reference(self):
        response=await self.client.post('/api/v1/voz/pruebas/'+ACTOR+'/actualizar',headers=ORIGIN,json={})
        self.assertEqual(response.status_code,404)
        self.mocks[4].assert_not_awaited()
        response=await self.client.post('/api/v1/voz/pruebas/'+REF+'/actualizar',headers=ORIGIN,json={})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['estado'],'completed')
        self.mocks[4].assert_awaited_once_with(SID)
        self.assertEqual(self.calls[-1][1]['data']['p_actor'],ACTOR)


class VoiceProviderTests(unittest.IsolatedAsyncioTestCase):
    async def test_full_account_blocked_before_recipient_discovery(self):
        with patch.object(voice_provider,'request',new=AsyncMock(return_value={'sid':settings.TWILIO_ACCOUNT_SID,'type':'Full','status':'active'})) as request:
            with self.assertRaises(VoiceError) as failure: await voice_provider.recipients()
        self.assertEqual(failure.exception.code,'CUENTA_NO_TRIAL');request.assert_awaited_once()

    async def test_new_trial_completed_calls_supply_known_destinations_only(self):
        async def request(method,path,**kwargs):
            if path=='.json':return {'sid':settings.TWILIO_ACCOUNT_SID,'type':'Trial','status':'active'}
            if path=='/OutgoingCallerIds.json':return {'outgoing_caller_ids':[]}
            return {'calls':[{'to':PHONE,'from':settings.TWILIO_FROM_NUMBER,'status':'completed','direction':'outbound-api'},
                {'to':'+51911111111','from':'OTHER','status':'completed','direction':'outbound-api'},
                {'to':'+51922222222','from':settings.TWILIO_FROM_NUMBER,'status':'failed','direction':'outbound-api'}]}
        with patch.object(voice_provider,'request',new=AsyncMock(side_effect=request)):
            result=await voice_provider.recipients()
        self.assertEqual(list(result.values()),[PHONE])

    async def test_trial_uses_only_console_fields_and_fixed_url(self):
        with patch.object(voice_provider,'check_trial',new=AsyncMock()),patch.object(voice_provider,'request',new=AsyncMock(return_value={'sid':SID,'status':'queued'})) as request:
            await voice_provider.call(PHONE)
        sent=request.await_args.kwargs['data']
        self.assertEqual(set(sent),{'To','From','Url'})
        self.assertEqual(sent['To'],PHONE)
        self.assertEqual(sent['Url'],settings.PUBLIC_APP_URL+'/api/v1/voz/prueba.xml')
        self.assertNotIn('Twiml',sent)

    async def test_zero_provider_code_is_preserved_without_echoing_message(self):
        def response(request):return httpx.Response(403,json={'code':0,'message':'SECRET_'+PHONE})
        client=httpx.AsyncClient(transport=httpx.MockTransport(response))
        with patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.voice.httpx.AsyncClient',return_value=client):
            with self.assertRaises(VoiceError) as failure:await voice_provider.request('POST','/Calls.json',data={'To':PHONE})
        self.assertEqual(failure.exception.code,'0')
        self.assertNotIn(PHONE,str(failure.exception))

    async def test_provider_error_never_exposes_raw_response(self):
        def response(request):return httpx.Response(403,json={'code':21219,'message':'SECRET_'+PHONE})
        client=httpx.AsyncClient(transport=httpx.MockTransport(response))
        with patch.object(VoiceProvider,'configured',new_callable=PropertyMock,return_value=True),patch('app.services.voice.httpx.AsyncClient',return_value=client):
            with self.assertRaises(VoiceError) as failure:await voice_provider.request('POST','/Calls.json',data={'To':PHONE})
        self.assertEqual(failure.exception.code,'21219')
        self.assertNotIn(PHONE,str(failure.exception))
