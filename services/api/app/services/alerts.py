"""Transactional outbox for reports of observed earthquakes, never predictions."""
import asyncio
from urllib.parse import urlparse
from app.core.config import settings
from app.services.database import database
from app.services.push import push_sender, PushError


async def process_alerts():
    if not push_sender.configured:
        rules=await database.request('GET','reglas_alerta',params={'select':'id','activa':'eq.true','canales':'eq.{push}','limit':'1'})
        if rules: raise RuntimeError('Hay reglas activas pero falta la credencial de Firebase en el ejecutor de sincronización.')
        return {'estado':'sin_reglas_activas','aceptadas':0,'fallidas':0}
    origin=urlparse(settings.PUBLIC_APP_URL)
    if origin.scheme!='https' or not origin.netloc or origin.username or origin.password or origin.path or origin.query or origin.fragment:
        raise RuntimeError('PUBLIC_APP_URL debe ser el origen HTTPS de SISMOCORE, sin rutas.')
    queued=await database.request('POST','rpc/sismocore_evaluar_reglas_push',data={})
    accepted=failed=0
    for _ in range(20):
        rows=await database.request('POST','rpc/sismocore_reservar_envios_push',data={'p_limite':5})
        if not rows: break
        async def dispatch(row):
            error=None; message_id=None
            try:
                message_id=await push_sender.send(row['token'],str(row['evento_id']),settings.PUBLIC_APP_URL,row['titulo'],row['mensaje'])
            except PushError as failure:
                error=failure.code
            await database.request('POST','rpc/sismocore_finalizar_envio_push',data={
                'p_id':row['id'],'p_reserva':row['reserva_id'],'p_aceptada':error is None,'p_codigo':error,'p_mensaje':message_id})
            return error is None
        results=await asyncio.gather(*(dispatch(row) for row in rows))
        accepted+=sum(results); failed+=len(results)-sum(results)
    return {'estado':'procesada','nuevas_entregas':queued,'aceptadas':accepted,'fallidas':failed}
