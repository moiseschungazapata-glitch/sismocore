import json
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import app
from app.api.routes.auth import attempts
from app.services.auth import ACCESS_COOKIE, REFRESH_COOKIE, auth

ORIGIN = {'Origin': 'http://localhost:5173'}
IDENTITY = {'id': '11111111-1111-4111-8111-111111111111', 'email': 'owner@example.org'}
PROFILE = {**IDENTITY, 'nombre_completo': '', 'rol': 'administrador', 'estado': 'activo'}
SESSION = {'access_token': 'valid-access-token-for-tests', 'refresh_token': 'valid-refresh-token-for-tests'}


class AuthTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        attempts.clear()
        self.calls = []
        self.failure = False
        self.profile = dict(PROFILE)
        self.transport = httpx.MockTransport(self.upstream)
        self.auth_client = httpx.AsyncClient(base_url='https://example.supabase.co/auth/v1/', transport=self.transport)
        self.old_client = auth.client
        auth.client = self.auth_client
        self.profile_patch = patch('app.services.auth.database.request', new=AsyncMock(side_effect=lambda *a, **kw: [self.profile]))
        self.profile_patch.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://localhost:5173')

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.auth_client.aclose()
        auth.client = self.old_client
        self.profile_patch.stop()
        attempts.clear()

    def upstream(self, request):
        self.calls.append(request)
        if self.failure:
            return httpx.Response(503, json={'message': 'private upstream detail'})
        data = json.loads(request.content) if request.content else {}
        path = request.url.path
        if path.endswith('/token'):
            if request.url.params.get('grant_type') == 'password':
                valid = data == {'email': IDENTITY['email'], 'password': 'test-only-password'}
            else:
                valid = data.get('refresh_token') == SESSION['refresh_token']
            return httpx.Response(200, json=SESSION) if valid else httpx.Response(400, json={'error': 'invalid_grant'})
        if path.endswith('/user'):
            if request.headers.get('authorization') != f'Bearer {SESSION["access_token"]}':
                return httpx.Response(401, json={'error': 'invalid_jwt'})
            return httpx.Response(200, json=IDENTITY)
        if path.endswith('/recover'):
            return httpx.Response(200, json={})
        if path.endswith('/logout'):
            return httpx.Response(204)
        raise AssertionError('Unexpected Auth path')

    async def login(self):
        return await self.client.post('/api/v1/auth/login', headers=ORIGIN,
            json={'email': IDENTITY['email'], 'password': 'test-only-password'})

    async def test_anonymous_catalog_and_health_are_denied(self):
        for path in ('/health', '/api/v1/eventos/', '/api/v1/auth/me'):
            result = await self.client.get(path)
            self.assertEqual(result.status_code, 401)
            self.assertEqual(result.headers['cache-control'], 'no-store')
        self.assertFalse(self.calls)

    async def test_login_uses_supabase_and_returns_no_tokens(self):
        response = await self.login()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['user']['rol'], 'administrador')
        self.assertNotIn('access_token', response.text)
        self.assertNotIn('refresh_token', response.text)
        for cookie in response.headers.get_list('set-cookie'):
            self.assertIn('HttpOnly', cookie)
            self.assertIn('SameSite=lax', cookie)
        self.assertEqual((await self.client.get('/api/v1/auth/me')).status_code, 200)

    async def test_wrong_password_is_generic_and_sets_no_cookies(self):
        result = await self.client.post('/api/v1/auth/login', headers=ORIGIN,
            json={'email': IDENTITY['email'], 'password': 'wrong-private-value'})
        self.assertEqual(result.status_code, 401)
        self.assertFalse(result.headers.get_list('set-cookie'))
        self.assertNotIn('wrong-private-value', result.text)
        self.assertNotIn('invalid_grant', result.text)

    async def test_inactive_profile_cannot_login(self):
        self.profile['estado'] = 'suspendido'
        result = await self.login()
        self.assertEqual(result.status_code, 403)
        self.assertFalse(result.headers.get_list('set-cookie'))

    async def test_profile_is_checked_again_after_login(self):
        await self.login()
        self.profile['estado'] = 'suspendido'
        self.assertEqual((await self.client.get('/api/v1/auth/me')).status_code, 403)

    async def test_expired_access_is_renewed_with_supabase(self):
        self.client.cookies.set(ACCESS_COOKIE, 'expired')
        self.client.cookies.set(REFRESH_COOKIE, SESSION['refresh_token'])
        result = await self.client.get('/api/v1/auth/me')
        self.assertEqual(result.status_code, 200)
        self.assertIn('sismocore_access=', result.headers['set-cookie'])
        self.assertTrue(any(call.url.params.get('grant_type') == 'refresh_token' for call in self.calls))

    async def test_invalid_refresh_is_rejected(self):
        self.client.cookies.set(REFRESH_COOKIE, 'forged-refresh')
        self.assertEqual((await self.client.get('/api/v1/auth/me')).status_code, 401)

    async def test_logout_revokes_upstream_and_removes_cookies(self):
        await self.login()
        result = await self.client.post('/api/v1/auth/logout', headers=ORIGIN)
        self.assertEqual(result.status_code, 204)
        self.assertFalse(self.client.cookies)
        self.assertTrue(any(call.url.path.endswith('/logout') for call in self.calls))
        self.assertEqual((await self.client.get('/api/v1/auth/me')).status_code, 401)

    async def test_csrf_login_and_logout_are_blocked(self):
        for path in ('login', 'logout', 'recover'):
            result = await self.client.post(f'/api/v1/auth/{path}', headers={'Origin': 'https://untrusted.example'},
                json={'email': IDENTITY['email'], 'password': 'test-only-password'} if path == 'login' else {'email': IDENTITY['email']} if path == 'recover' else {})
            self.assertEqual(result.status_code, 403)
        self.assertFalse(self.calls)

    async def test_logout_renews_expired_token_before_revoking_session(self):
        self.client.cookies.set(ACCESS_COOKIE, 'expired', domain='localhost.local', path='/')
        self.client.cookies.set(REFRESH_COOKIE, SESSION['refresh_token'], domain='localhost.local', path='/')
        result = await self.client.post('/api/v1/auth/logout', headers=ORIGIN)
        self.assertEqual(result.status_code, 204)
        self.assertEqual(self.calls[-1].headers['authorization'], f'Bearer {SESSION["access_token"]}')
        self.assertFalse(self.client.cookies)

    async def test_validation_never_echoes_password_or_token(self):
        result = await self.client.post('/api/v1/auth/password', headers=ORIGIN, json={'password': 'private'})
        self.assertNotIn('private', result.text)
        result = await self.client.post('/api/v1/auth/login', headers=ORIGIN, json={'email': 'x', 'password': 'private'})
        self.assertEqual(result.status_code, 422)
        self.assertNotIn('private', result.text)

    async def test_upstream_failure_is_safe_and_does_not_issue_session(self):
        self.failure = True
        result = await self.login()
        self.assertEqual(result.status_code, 503)
        self.assertNotIn('private upstream detail', result.text)
        self.assertFalse(result.headers.get_list('set-cookie'))

    async def test_login_rate_limit(self):
        for _ in range(10):
            self.assertEqual((await self.login()).status_code, 200)
        self.assertEqual((await self.login()).status_code, 429)

    async def test_recovery_uses_allowed_origin_without_account_enumeration(self):
        result = await self.client.post('/api/v1/auth/recover', headers=ORIGIN, json={'email': 'unknown@example.org'})
        self.assertEqual(result.status_code, 200)
        self.assertIn('Si el correo', result.json()['message'])
        self.assertEqual(self.calls[-1].url.params['redirect_to'], 'http://localhost:5173/index/restablecer')

    async def test_password_change_requires_session_and_uses_authenticated_token(self):
        result = await self.client.post('/api/v1/auth/password', headers=ORIGIN, json={'password': 'new-test-password'})
        self.assertEqual(result.status_code, 401)
        self.client.cookies.set(ACCESS_COOKIE, 'expired')
        self.client.cookies.set(REFRESH_COOKIE, SESSION['refresh_token'])
        result = await self.client.post('/api/v1/auth/password', headers=ORIGIN, json={'password': 'new-test-password'})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(self.calls[-1].headers['authorization'], f'Bearer {SESSION["access_token"]}')

    async def test_recovery_session_only_stores_verified_tokens(self):
        result = await self.client.post('/api/v1/auth/session', headers=ORIGIN, json=SESSION)
        self.assertEqual(result.status_code, 200)
        self.assertNotIn('access_token', result.text)
        self.client.cookies.clear()
        result = await self.client.post('/api/v1/auth/session', headers=ORIGIN,
            json={**SESSION, 'access_token': 'forged-access-token-for-tests'})
        self.assertEqual(result.status_code, 401)
        self.assertFalse(self.client.cookies)


if __name__ == '__main__':
    unittest.main()
