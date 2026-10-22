import time
from collections import defaultdict, deque
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.core.config import settings
from app.services.auth import ACCESS_COOKIE, REFRESH_COOKIE, auth, require_user

router = APIRouter(prefix='/auth', tags=['Acceso'])


class Credentials(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=1, max_length=1024)


class Recovery(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: str = Field(min_length=3, max_length=254)


class Password(BaseModel):
    model_config = ConfigDict(extra='forbid')
    password: SecretStr = Field(min_length=12, max_length=1024)


class RecoverySession(BaseModel):
    model_config = ConfigDict(extra='forbid')
    access_token: SecretStr = Field(min_length=20, max_length=8192)
    refresh_token: SecretStr = Field(min_length=1, max_length=8192)


attempts = defaultdict(deque)


def guard(request: Request, kind: Literal['login', 'recover', 'session', 'password', 'logout']):
    origin = request.headers.get('origin', '')
    if origin not in settings.CORS_ORIGINS:
        raise HTTPException(403, 'La solicitud no proviene de una dirección autorizada.')
    if kind == 'logout':
        return
    now = time.monotonic()
    # Bounded, short-lived buckets. Never use emails or passwords as keys.
    for key in list(attempts):
        if not attempts[key] or attempts[key][-1] < now - 60:
            del attempts[key]
    key = (request.client.host if request.client else 'unknown', kind)
    bucket = attempts[key]
    while bucket and bucket[0] < now - 60:
        bucket.popleft()
    if len(bucket) >= (3 if kind == 'recover' else 10) or len(attempts) > 10000:
        raise HTTPException(429, 'Demasiados intentos. Espera un minuto antes de volver a intentarlo.')
    bucket.append(now)


@router.post('/login')
async def login(body: Credentials, request: Request, response: Response):
    guard(request, 'login')
    result = await auth.request('POST', 'token', params={'grant_type': 'password'},
        data={'email': body.email.strip(), 'password': body.password.get_secret_value()})
    if result.is_error:
        raise HTTPException(401, 'Correo o contraseña incorrectos. Verifica tus datos.')
    session = result.json()
    profile = await auth.profile(await auth.user(session['access_token']))
    auth.set_session(response, session)
    return {'user': profile}


@router.get('/me')
async def me(user=Depends(require_user)):
    return {'user': user}


@router.post('/logout')
async def logout(request: Request):
    guard(request, 'logout')
    response = Response(status_code=204)
    token = request.cookies.get(ACCESS_COOKIE)
    try:
        if token:
            valid = await auth.request('GET', 'user', token=token)
        else:
            valid = None
        refresh = request.cookies.get(REFRESH_COOKIE)
        if refresh and (valid is None or valid.status_code == 401):
            renewed = await auth.request('POST', 'token', params={'grant_type': 'refresh_token'},
                data={'refresh_token': refresh})
            if renewed.is_success:
                token = renewed.json()['access_token']
        if token:
            result = await auth.request('POST', 'logout', token=token, params={'scope': 'local'})
            if result.status_code not in (200, 204, 401, 403):
                response.status_code = 503
    except HTTPException:
        response.status_code = 503
    # Local logout always removes both cookies, including while Supabase is offline.
    auth.clear_session(response)
    return response


@router.post('/recover')
async def recover(body: Recovery, request: Request):
    guard(request, 'recover')
    origin = request.headers['origin']
    result = await auth.request('POST', 'recover', data={'email': body.email.strip()},
        params={'redirect_to': f'{origin}/index/restablecer'})
    if result.is_error and result.status_code not in (400, 404, 422):
        raise HTTPException(503, 'No se pudo solicitar la recuperación. Inténtalo más tarde.')
    return {'message': 'Si el correo tiene una cuenta, recibirás un enlace para restablecer la contraseña.'}


@router.post('/session')
async def recovery_session(body: RecoverySession, request: Request, response: Response):
    guard(request, 'session')
    user = await auth.user(body.access_token.get_secret_value())
    profile = await auth.profile(user)
    # Validate the refresh token and its binding to the same identity before storing it.
    renewed = await auth.request('POST', 'token', params={'grant_type': 'refresh_token'},
        data={'refresh_token': body.refresh_token.get_secret_value()})
    if renewed.is_error:
        raise HTTPException(401, 'El enlace ha vencido. Solicita uno nuevo.')
    session = renewed.json()
    if (await auth.user(session['access_token']))['id'] != user['id']:
        raise HTTPException(401, 'El enlace de recuperación no es válido.')
    auth.set_session(response, session)
    return {'user': profile}


@router.post('/password')
async def change_password(body: Password, request: Request, user=Depends(require_user)):
    guard(request, 'password')
    # Supabase validates the authenticated identity and the configured password policy.
    result = await auth.request('PUT', 'user', token=request.state.auth_access_token,
        data={'password': body.password.get_secret_value()})
    if result.is_error:
        raise HTTPException(400, 'No se pudo cambiar la contraseña. Usa una nueva de al menos 12 caracteres o solicita otro enlace.')
    return {'message': 'Contraseña actualizada. Ya puedes continuar al sistema.'}
