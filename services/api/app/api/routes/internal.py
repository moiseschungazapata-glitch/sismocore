"""Machine-only cron endpoint: no cookies, no query-string credentials."""
import hmac
import re
from fastapi import APIRouter, Depends, HTTPException, Request
from app.core.config import settings
from app.services.database import database
from app.services.push import push_sender
from app.services.voice import voice_provider
from app.services.scheduled import synchronize

router = APIRouter(prefix='/interno', tags=['Sincronización privada'])


def cron_access(request:Request):
    secret = settings.SYNC_CRON_SECRET
    header = request.headers.get('Authorization', '')
    if (not re.fullmatch(r'[a-f0-9]{64}', secret) or len(header) > 100
        or not hmac.compare_digest(header.encode(), ('Bearer '+secret).encode())):
        raise HTTPException(401, 'Acceso privado no autorizado.')


@router.get('/sincronizacion', dependencies=[Depends(cron_access)])
async def readiness():
    if not settings.database_configured:
        raise HTTPException(503, 'Falta configurar la conexión privada con Supabase.')
    state = await database.request('POST', 'rpc/sismocore_estado_sincronizacion', data={})
    sources = await database.request('GET','fuentes_datos', params={
        'codigo':'eq.igp','select':'activa,limites','limit':'1'})
    rules = await database.request('GET','reglas_alerta',params={
        'activa':'eq.true','select':'canales','limit':'20'})
    flags = sources[0].get('limites',{}) if sources else {}
    channels = {c for rule in rules for c in rule['canales']}
    missing = []
    if 'push' in channels and flags.get('push_habilitado') is not False and not push_sender.configured:
        missing.append('Firebase')
    for channel, flag in [('voz','voz'),('sms','sms')]:
        if channel in channels and flags.get(flag+'_habilitada') is True and (
            not voice_provider.configured or flags.get(flag+'_cuenta') != voice_provider.account_hash):
            missing.append('Twilio '+channel)
    return {'version':'supabase-cron-v1', 'listo':bool(sources and sources[0]['activa'] and not missing),
        'faltantes':missing,'programacion':state}


@router.post('/sincronizacion', dependencies=[Depends(cron_access)])
async def scheduled_sync():
    if not settings.database_configured:
        raise HTTPException(503, 'Conexión privada no disponible.')
    try:
        return await synchronize()
    except Exception:
        # Provider errors may include URLs or credentials: never echo their details.
        raise HTTPException(503, 'La sincronización no se completó. Consulta Fuentes de datos y el historial de Cron.') from None
