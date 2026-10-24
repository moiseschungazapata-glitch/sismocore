import asyncio
import re
from datetime import date, datetime, timedelta, timezone
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

from app.api.routes.auth import guard
from app.services import audit
from app.services.auth import auth
from app.services.database import database, DatabaseError
from app.services.permissions import ROLE_PERMISSIONS, require_permission

router = APIRouter(tags=['Usuarios y auditoría'])
Role = Literal['administrador','analista','operador','auditor','lectura']
State = Literal['pendiente','activo','suspendido']
PROFILE_FIELDS = 'id,nombre_completo,rol,estado,creado_en,actualizado_en'


class ProfileChange(BaseModel):
    model_config = ConfigDict(extra='forbid')
    nombre_completo: str = Field(min_length=2, max_length=120)
    rol: Role
    estado: State
    actualizado_en: datetime

    @field_validator('nombre_completo')
    @classmethod
    def valid_name(cls, value):
        value = value.strip()
        if len(value) < 2 or any(ord(c) < 32 for c in value):
            raise ValueError('Nombre inválido')
        return value


class NewUser(BaseModel):
    model_config = ConfigDict(extra='forbid')
    nombre_completo: str = Field(min_length=2, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    password: SecretStr = Field(min_length=12, max_length=1024)
    rol: Role = 'lectura'
    estado: State = 'pendiente'

    @field_validator('nombre_completo')
    @classmethod
    def valid_name(cls, value):
        return ProfileChange.valid_name(value)

    @field_validator('email')
    @classmethod
    def valid_email(cls, value):
        value = value.strip()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Correo inválido')
        return value


async def account(profile):
    result = await auth.admin_request('GET', f'admin/users/{profile["id"]}')
    if result.is_error:
        raise HTTPException(503, 'No se pudieron consultar los datos de la cuenta en Supabase Auth.')
    identity = result.json()
    return {**profile, 'email': identity.get('email', ''),
        'ultimo_acceso_en': identity.get('last_sign_in_at'),
        'mfa_activo': any(f.get('status') == 'verified' for f in (identity.get('factors') or [])),
        'permisos': ROLE_PERMISSIONS.get(profile['rol'], [])}


async def update_profile(request, user, user_id, changes):
    try:
        return await database.request('POST', 'rpc/sismocore_actualizar_perfil', data={
            'p_actor_id': user['id'], 'p_usuario_id': str(user_id),
            'p_nombre': changes.nombre_completo, 'p_rol': changes.rol, 'p_estado': changes.estado,
            'p_actualizado_en': changes.actualizado_en.isoformat(),
            'p_correlacion_id': request.state.correlation_id,
        })
    except DatabaseError as exc:
        messages = {
            'PT403': (403, 'Ya no tienes permiso para administrar usuarios.'),
            'PT404': (404, 'La cuenta no existe.'),
            'PT409': (409, 'La cuenta cambió o la operación dejaría tu acceso sin protección. Recarga la lista; no puedes cambiar tu propio rol ni suspenderte.'),
            'PT422': (422, 'Revisa los datos del perfil.'),
        }
        if exc.code in messages:
            status, message = messages[exc.code]
            await audit.record(request, 'acceso.denegado', 'perfiles', actor=user, target=user_id,
                result='denegado', details={'motivo': 'cambio_perfil_rechazado'})
            raise HTTPException(status, message,
                headers={'X-Permission-Denied':'true'} if status == 403 else None) from exc
        raise


@router.get('/usuarios/roles')
async def roles(user=Depends(require_permission('usuarios.administrar'))):
    return {'roles': ROLE_PERMISSIONS}


@router.get('/usuarios')
async def list_users(request: Request, pagina: int = Query(1, ge=1),
    tamano: int = Query(20, ge=1, le=50), rol: Role | None = None, estado: State | None = None,
    user=Depends(require_permission('usuarios.administrar'))):
    params = {'select':PROFILE_FIELDS, 'order':'creado_en.desc,id', 'limit':str(tamano), 'offset':str((pagina - 1) * tamano)}
    if rol: params['rol'] = f'eq.{rol}'
    if estado: params['estado'] = f'eq.{estado}'
    profiles, total = await database.page('perfiles', params=params)
    # Bounded page size; no full scan of Auth accounts and no credentials returned.
    semaphore = asyncio.Semaphore(5)
    async def enrich(profile):
        async with semaphore:
            return await account(profile)
    rows = await asyncio.gather(*(enrich(p) for p in profiles))
    await audit.record(request, 'usuario.consultar', 'perfiles', actor=user, details={'pagina':pagina})
    return {'usuarios':rows, 'total':total, 'pagina':pagina, 'tamano':tamano}


@router.post('/usuarios', status_code=201)
async def create_user(body: NewUser, request: Request, user=Depends(require_permission('usuarios.administrar'))):
    guard(request, 'admin')
    result = await auth.admin_request('POST', 'admin/users', data={
        'email':body.email, 'password':body.password.get_secret_value(),
        'email_confirm':True, 'user_metadata':{'full_name':body.nombre_completo},
    })
    if result.status_code in (400, 409, 422):
        raise HTTPException(409, 'No se pudo crear la cuenta. Revisa si el correo ya está registrado o si la contraseña cumple la política de Supabase.')
    if result.is_error:
        raise HTTPException(503, 'No se pudo crear la cuenta en Supabase Auth.')
    created = result.json()
    user_id = UUID(created['id'])
    try:
        profiles = await database.request('GET', 'perfiles', params={'select':PROFILE_FIELDS,'id':f'eq.{user_id}','limit':'1'})
        if not profiles:
            raise DatabaseError()
        changes = ProfileChange(nombre_completo=body.nombre_completo, rol=body.rol, estado=body.estado,
                                actualizado_en=profiles[0]['actualizado_en'])
        profile = await update_profile(request, user, user_id, changes)
        await audit.record(request, 'usuario.crear', 'perfiles', actor=user, target=user_id,
            details={'rol':body.rol,'estado':body.estado})
    except (DatabaseError, HTTPException) as exc:
        # Auth creation and database updates are different services. Never delete a
        # created account as an automatic rollback; its default profile is pending.
        raise HTTPException(503, 'La cuenta se creó en Auth, pero no se confirmó su configuración completa. Actualiza la lista y revisa su perfil antes de volver a crearla.') from exc
    return {'usuario':await account(profile)}


@router.patch('/usuarios/{user_id}')
async def edit_user(user_id: UUID, body: ProfileChange, request: Request,
    user=Depends(require_permission('usuarios.administrar'))):
    guard(request, 'admin')
    profile = await update_profile(request, user, user_id, body)
    return {'usuario':await account(profile)}


@router.get('/auditoria')
async def list_audit(request: Request, pagina: int = Query(1, ge=1), tamano: int = Query(20, ge=1, le=50),
    accion: str | None = Query(None, pattern=r'^[a-zA-Z_.]{1,50}$'),
    entidad: str | None = Query(None, pattern=r'^[a-z_]{1,50}$'),
    resultado: Literal['correcto','error','denegado'] | None = None,
    actor_id: UUID | None = None, desde: date | None = None, hasta: date | None = None,
    fecha_corte: datetime | None = None,
    user=Depends(require_permission('auditoria.leer'))):
    if desde and hasta and desde > hasta:
        raise HTTPException(422, 'La fecha inicial no puede ser posterior a la final.')
    params = {'select':'id,actor_id,actor_tipo,accion,entidad,entidad_id,antes,despues,resultado,ocurrido_en,correlacion_id,actor:perfiles!auditoria_actor_id_fkey(nombre_completo)',
              'order':'ocurrido_en.desc,id', 'limit':str(tamano), 'offset':str((pagina - 1) * tamano)}
    for field, value in [('accion',accion),('entidad',entidad),('resultado',resultado),('actor_id',actor_id)]:
        if value is not None: params[field] = f'eq.{value}'
    now = datetime.now(timezone.utc)
    if fecha_corte and fecha_corte.tzinfo is None:
        raise HTTPException(422, 'La fecha de corte debe incluir zona horaria.')
    cutoff = min(fecha_corte, now) if fecha_corte else now
    bounds = [f'ocurrido_en.lte.{cutoff.isoformat()}']
    if desde: bounds.append(f'ocurrido_en.gte.{desde.isoformat()}T00:00:00Z')
    if hasta and hasta < date.max:
        bounds.append(f'ocurrido_en.lt.{(hasta + timedelta(days=1)).isoformat()}T00:00:00Z')
    if bounds: params['and'] = f'({",".join(bounds)})'
    rows, total = await database.page('auditoria', params=params)
    await audit.record(request, 'auditoria.consultar', 'auditoria', actor=user, details={'pagina':pagina})
    return {'registros':rows, 'total':total, 'pagina':pagina, 'tamano':tamano,'fecha_corte':cutoff.isoformat()}
