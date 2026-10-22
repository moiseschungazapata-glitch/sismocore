"""Supabase owns identities and passwords; only HttpOnly sessions reach the browser."""
import httpx
from fastapi import HTTPException, Request, Response

from app.core.config import settings
from app.services.database import database

ACCESS_COOKIE = 'sismocore_access'
REFRESH_COOKIE = 'sismocore_refresh'


class Auth:
    def __init__(self):
        self.client = None

    async def open(self):
        self.client = httpx.AsyncClient(
            base_url=f'{settings.SUPABASE_URL}/auth/v1/',
            headers={'apikey': settings.SUPABASE_SECRET_KEY},
            timeout=httpx.Timeout(20, connect=10),
        )

    async def close(self):
        if self.client:
            await self.client.aclose()

    async def request(self, method, path, *, data=None, token=None, params=None):
        if not settings.database_configured or self.client is None:
            raise HTTPException(503, 'El servicio de acceso no está disponible. Inténtalo de nuevo.')
        try:
            response = await self.client.request(method, path, json=data, params=params,
                headers={'Authorization': f'Bearer {token}'} if token else None)
        except httpx.HTTPError as exc:
            raise HTTPException(503, 'No se pudo contactar con el servicio de acceso. Inténtalo de nuevo.') from exc
        if response.status_code >= 500:
            raise HTTPException(503, 'El servicio de acceso no está disponible. Inténtalo de nuevo.')
        if response.status_code == 429:
            raise HTTPException(429, 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.')
        return response

    async def profile(self, user):
        rows = await database.request('GET', 'perfiles', params={
            'select': 'id,nombre_completo,rol,estado', 'id': f'eq.{user["id"]}', 'limit': '1'})
        if not rows or rows[0]['estado'] != 'activo':
            raise HTTPException(403, 'Tu cuenta está pendiente de activación o suspendida. Contacta al administrador.')
        return {'id': user['id'], 'email': user.get('email', ''), **rows[0]}

    async def user(self, token):
        result = await self.request('GET', 'user', token=token)
        if result.is_error:
            raise HTTPException(401, 'Tu sesión ha terminado. Vuelve a iniciar sesión.')
        return result.json()

    def set_session(self, response, session):
        options = {'httponly': True, 'secure': settings.AUTH_COOKIE_SECURE,
                   'samesite': 'lax', 'path': '/'}
        # Keep an expired access token long enough to renew using the refresh cookie.
        response.set_cookie(ACCESS_COOKIE, session['access_token'], max_age=30 * 86400, **options)
        response.set_cookie(REFRESH_COOKIE, session['refresh_token'], max_age=30 * 86400, **options)
        response.headers['Cache-Control'] = 'no-store'

    def clear_session(self, response):
        for cookie in (ACCESS_COOKIE, REFRESH_COOKIE):
            response.delete_cookie(cookie, path='/', secure=settings.AUTH_COOKIE_SECURE,
                                   httponly=True, samesite='lax')
        response.headers['Cache-Control'] = 'no-store'

    async def current(self, request: Request, response: Response):
        token = request.cookies.get(ACCESS_COOKIE)
        refresh = request.cookies.get(REFRESH_COOKIE)
        if not token and not refresh:
            raise HTTPException(401, 'Inicia sesión para acceder al sistema.')
        try:
            user = await self.user(token) if token else None
        except HTTPException as exc:
            if exc.status_code != 401:
                raise
            user = None
        if user is None:
            if not refresh:
                raise HTTPException(401, 'Tu sesión ha terminado. Vuelve a iniciar sesión.')
            renewed = await self.request('POST', 'token',
                params={'grant_type': 'refresh_token'}, data={'refresh_token': refresh})
            if renewed.is_error:
                raise HTTPException(401, 'Tu sesión ha terminado. Vuelve a iniciar sesión.')
            session = renewed.json()
            token = session['access_token']
            user = await self.user(session['access_token'])
            # A suspended profile must never obtain renewed browser cookies.
            profile = await self.profile(user)
            self.set_session(response, session)
        else:
            profile = await self.profile(user)
        response.headers['Cache-Control'] = 'no-store'
        request.state.auth_access_token = token
        return profile


auth = Auth()


async def require_user(request: Request, response: Response):
    return await auth.current(request, response)
