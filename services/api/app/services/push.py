"""FCM HTTP v1. Private OAuth credentials never reach the browser or audit logs."""
import asyncio
import json
import time

import httpx
from google.auth import jwt
from google.oauth2 import service_account

from app.core.config import settings


class PushError(Exception):
    def __init__(self, code='UNAVAILABLE'):
        self.code = code
        super().__init__('No se pudo confirmar el envío de la notificación.')


class PushSender:
    def __init__(self):
        self._oauth_token = None
        self._expires = 0
        self._lock = asyncio.Lock()

    def credentials(self):
        try:
            info = json.loads(settings.FIREBASE_SERVICE_ACCOUNT_JSON)
            if not isinstance(info,dict) or info.get('type') != 'service_account' or info.get('project_id') != settings.FIREBASE_PROJECT_ID:
                return None
            return service_account.Credentials.from_service_account_info(info)
        except (ValueError, TypeError, KeyError):
            return None

    @property
    def configured(self):
        return self.credentials() is not None

    async def access_token(self, client):
        async with self._lock:
            if self._oauth_token and self._expires > time.time() + 60:
                return self._oauth_token
            credentials = self.credentials()
            if credentials is None:
                raise PushError('AUTHENTICATION_ERROR')
            now = int(time.time())
            assertion = jwt.encode(credentials.signer, {
                'iss':credentials.service_account_email, 'aud':'https://oauth2.googleapis.com/token',
                'scope':'https://www.googleapis.com/auth/firebase.messaging', 'iat':now, 'exp':now + 3600,
            }).decode('ascii')
            response = await client.post('https://oauth2.googleapis.com/token', data={
                'grant_type':'urn:ietf:params:oauth:grant-type:jwt-bearer','assertion':assertion})
            if response.is_error:
                raise PushError('AUTHENTICATION_ERROR')
            payload = response.json()
            self._oauth_token = payload['access_token']
            self._expires = time.time() + min(int(payload.get('expires_in',3600)),3600)
            return self._oauth_token

    async def test(self, token, correlation_id, origin):
        return await self.send(token,correlation_id,origin,'SISMOCORE · Prueba de notificación',
            'La conexión de notificaciones está funcionando. Este mensaje es una prueba; no es una alerta sísmica.','prueba')

    async def send(self, token, correlation_id, origin, title, body, kind='evento_observado'):
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(10,connect=5)) as client:
                oauth = await self.access_token(client)
                result = await client.post(
                    f'https://fcm.googleapis.com/v1/projects/{settings.FIREBASE_PROJECT_ID}/messages:send',
                    headers={'Authorization':f'Bearer {oauth}'}, json={'message':{
                        'token':token,
                        'notification':{'title':title,'body':body},
                        'data':{'tipo':kind,'referencia':correlation_id,'ruta':'/alertas'},
                        'webpush':{'headers':{'TTL':'60' if kind=='prueba' else '300'}, 'notification':{
                            'tag':f'sismocore-{kind}-{correlation_id}','icon':f'{origin}/favicon.svg'},
                            'fcm_options':{'link':f'{origin}/alertas'}},
                    }})
                payload = result.json()
                if result.is_error:
                    error = payload.get('error',{})
                    code = next((detail.get('errorCode') for detail in error.get('details',[]) if detail.get('errorCode')),error.get('status'))
                    if code not in ('UNREGISTERED','INVALID_ARGUMENT','PERMISSION_DENIED','QUOTA_EXCEEDED'):
                        code = 'UNAVAILABLE'
                    if result.status_code == 401:
                        self._oauth_token = None
                        code = 'AUTHENTICATION_ERROR'
                    raise PushError(code)
                message_id = payload.get('name')
                if not isinstance(message_id,str) or not message_id.startswith(f'projects/{settings.FIREBASE_PROJECT_ID}/messages/'):
                    raise PushError()
                return message_id
        except (httpx.HTTPError,ValueError,KeyError,TypeError,AttributeError) as exc:
            raise PushError() from exc


push_sender = PushSender()
