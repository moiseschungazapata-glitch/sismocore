import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, PropertyMock, patch

import httpx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.auth import jwt

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import auth, require_user, ACCESS_COOKIE
from app.services.database import DatabaseError
from app.services.push import PushSender, PushError, push_sender
from app.core.config import settings
from app.services.permissions import ROLE_PERMISSIONS
from app.api.routes.auth import attempts

USER='11111111-1111-4111-8111-111111111111'
DEVICE='22222222-2222-4222-8222-222222222222'
TOKEN='private-test-device-token-'+('z'*60)
ORIGIN={'Origin':'http://localhost:5173'}


class NotificationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        attempts.clear()
        self.actor={'id':USER,'rol':'lectura','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor)
        self.calls=[]
        self.failure=None
        async def database(method,table,**kw):
            self.calls.append((method,table,kw))
            if self.failure: raise self.failure
            if table=='reglas_alerta': return []
            if table=='dispositivos_notificacion': return [{'id':DEVICE,'token':TOKEN,'token_hash':'NEVER'}]
            if table.endswith('sismocore_preparar_prueba_push'): return {'token':TOKEN,'prueba_id':DEVICE}
            if table.endswith('sismocore_registrar_dispositivo'): return {'id':DEVICE,'token':TOKEN}
            return True
        self.db_patch=patch('app.services.database.database.request',new=AsyncMock(side_effect=database))
        self.db_patch.start()
        self.config_patch=patch.object(PushSender,'configured',new_callable=PropertyMock,return_value=True)
        self.config=self.config_patch.start()
        self.send_patch=patch.object(push_sender,'test',new=AsyncMock(return_value='projects/test/messages/1'))
        self.send=self.send_patch.start()
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')

    async def asyncTearDown(self):
        await self.client.aclose()
        self.db_patch.stop(); self.config_patch.stop(); self.send_patch.stop()
        app.dependency_overrides.clear(); attempts.clear()

    async def test_all_active_roles_can_read_only_own_metadata(self):
        for role in ROLE_PERMISSIONS:
            self.actor['rol']=role
            response=await self.client.get('/api/v1/notificaciones')
            self.assertEqual(response.status_code,200)
            self.assertNotIn(TOKEN,response.text)
            self.assertNotIn('NEVER',response.text)
            self.assertEqual(next(call[2]['params']['usuario_id'] for call in self.calls if call[1]=='dispositivos_notificacion'),'eq.'+USER)
            self.assertFalse(response.json()['automaticas_activas'])

    async def test_anonymous_cannot_read_devices(self):
        app.dependency_overrides.clear()
        response=await self.client.get('/api/v1/notificaciones')
        self.assertEqual(response.status_code,401)
        self.assertFalse(self.calls)

    async def test_register_uses_verified_identity_and_hides_token(self):
        response=await self.client.post('/api/v1/notificaciones/dispositivos',headers=ORIGIN,json={'token':TOKEN,'etiqueta':'Android'})
        self.assertEqual(response.status_code,200)
        self.assertNotIn(TOKEN,response.text)
        self.assertEqual(self.calls[-1][2]['data']['p_usuario_id'],USER)

    async def test_forged_actor_rejected_without_echo(self):
        response=await self.client.post('/api/v1/notificaciones/dispositivos',headers=ORIGIN,json={'token':TOKEN,'etiqueta':'Android','usuario_id':DEVICE})
        self.assertEqual(response.status_code,422)
        self.assertNotIn(TOKEN,response.text)
        self.assertFalse(self.calls)

    async def test_cross_origin_cannot_send(self):
        response=await self.client.post(f'/api/v1/notificaciones/dispositivos/{DEVICE}/prueba',headers={'Origin':'https://other.invalid'},json={})
        self.assertEqual(response.status_code,403)
        self.send.assert_not_awaited()
        self.assertFalse(self.calls)

    async def test_missing_private_credential_does_not_claim_or_send(self):
        self.config.return_value=False
        response=await self.client.post(f'/api/v1/notificaciones/dispositivos/{DEVICE}/prueba',headers=ORIGIN,json={})
        self.assertEqual(response.status_code,503)
        self.assertFalse(self.calls)
        self.send.assert_not_awaited()

    async def test_non_owned_device_and_cooldown_prevent_dispatch(self):
        for code,status in [('PT404',404),('PT429',429),('PT403',403)]:
            self.failure=DatabaseError(code=code)
            response=await self.client.post(f'/api/v1/notificaciones/dispositivos/{DEVICE}/prueba',headers=ORIGIN,json={})
            self.assertEqual(response.status_code,status)
        self.send.assert_not_awaited()

    async def test_acceptance_is_recorded_and_not_reported_as_delivery(self):
        response=await self.client.post(f'/api/v1/notificaciones/dispositivos/{DEVICE}/prueba',headers=ORIGIN,json={})
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json()['estado'],'aceptada')
        self.assertNotIn(TOKEN,response.text)
        self.assertEqual(self.send.await_args.args[0],TOKEN)
        self.assertEqual(self.send.await_args.args[2],ORIGIN['Origin'])
        result=self.calls[-1][2]['data']
        self.assertEqual(result['p_usuario_id'],USER)
        self.assertEqual(result['p_prueba_id'],DEVICE)
        self.assertTrue(result['p_aceptada'])

    async def test_provider_failure_is_sanitized_and_recorded(self):
        self.send.side_effect=PushError('UNREGISTERED')
        response=await self.client.post(f'/api/v1/notificaciones/dispositivos/{DEVICE}/prueba',headers=ORIGIN,json={})
        self.assertEqual(response.status_code,503)
        self.assertNotIn(TOKEN,response.text)
        self.assertEqual(self.calls[-1][2]['data']['p_error_codigo'],'UNREGISTERED')
        self.assertFalse(self.calls[-1][2]['data']['p_aceptada'])

    async def test_logout_revokes_device_with_server_verified_identity(self):
        async def upstream(method,path,**kwargs):
            return httpx.Response(200,json={'id':USER})
        self.client.cookies.set(ACCESS_COOKIE,'session-only-test')
        with patch.object(auth,'request',new=AsyncMock(side_effect=upstream)),patch('app.services.audit.record',new=AsyncMock()):
            response=await self.client.post('/api/v1/auth/logout',headers=ORIGIN,json={'dispositivo_id':DEVICE})
        self.assertEqual(response.status_code,204)
        revoked=next(call[2]['data'] for call in self.calls if call[1].endswith('sismocore_desactivar_dispositivo'))
        self.assertEqual(revoked['p_usuario_id'],USER)
        self.assertEqual(revoked['p_dispositivo_id'],DEVICE)
        self.assertTrue(any('Max-Age=0' in value for value in response.headers.get_list('set-cookie')))


class SenderTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        # Ephemeral test key, never written to disk or used with Google.
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        cls.info={'type':'service_account','project_id':'unit-test','client_email':'test@unit-test.iam.gserviceaccount.com',
            'token_uri':'https://oauth2.googleapis.com/token','private_key':key.private_bytes(serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,serialization.NoEncryption()).decode()}

    async def test_signed_oauth_cached_and_fixed_test_payload(self):
        calls=[]
        def upstream(request):
            calls.append(request)
            if request.url.host=='oauth2.googleapis.com':
                from urllib.parse import parse_qs
                claims=jwt.decode(parse_qs(request.content.decode())['assertion'][0],verify=False)
                self.assertEqual(claims['scope'],'https://www.googleapis.com/auth/firebase.messaging')
                return httpx.Response(200,json={'access_token':'test-oauth','expires_in':3600})
            payload=json.loads(request.content)['message']
            self.assertEqual(payload['token'],TOKEN)
            self.assertEqual(payload['data']['tipo'],'prueba')
            self.assertIn('no es una alerta sísmica',payload['notification']['body'])
            self.assertEqual(payload['webpush']['headers']['TTL'],'60')
            self.assertEqual(payload['webpush']['fcm_options']['link'],'https://test.invalid/alertas')
            return httpx.Response(200,json={'name':'projects/unit-test/messages/123'})
        client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        fresh=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        with patch.object(settings,'FIREBASE_PROJECT_ID','unit-test'),patch.object(settings,'FIREBASE_SERVICE_ACCOUNT_JSON',json.dumps(self.info)),patch('app.services.push.httpx.AsyncClient',return_value=client):
            sender=PushSender()
            self.assertTrue(sender.configured)
            # Reuse the OAuth call on the same client; no external network.
            await sender.access_token(client); await sender.access_token(client)
            self.assertEqual(len(calls),1)
            await client.aclose()
            with patch('app.services.push.httpx.AsyncClient',return_value=fresh):
                await sender.test(TOKEN,DEVICE,'https://test.invalid')
            self.assertEqual(len(calls),2)

    async def test_wrong_project_or_invalid_credential_is_not_configured(self):
        with patch.object(settings,'FIREBASE_PROJECT_ID','other'),patch.object(settings,'FIREBASE_SERVICE_ACCOUNT_JSON',json.dumps(self.info)):
            self.assertFalse(PushSender().configured)
        with patch.object(settings,'FIREBASE_SERVICE_ACCOUNT_JSON','invalid-private-sentinel'):
            self.assertFalse(PushSender().configured)

    async def test_raw_provider_response_never_leaks(self):
        def upstream(request):
            return httpx.Response(404,json={'error':{'message':TOKEN,'details':[{'errorCode':'UNREGISTERED'}]}})
        client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        sender=PushSender()
        with patch.object(sender,'access_token',new=AsyncMock(return_value='test')),patch('app.services.push.httpx.AsyncClient',return_value=client):
            with self.assertRaises(PushError) as result:
                await sender.test(TOKEN,DEVICE,'https://test.invalid')
            self.assertEqual(result.exception.code,'UNREGISTERED')
            self.assertNotIn(TOKEN,str(result.exception))
