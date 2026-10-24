"""Opt-in Trial demonstration SMS triggered by new IGP observations."""
import asyncio
from app.services.database import database
from app.services.sms import sms_provider
from app.services.voice import VoiceError


async def process_automatic_sms():
    sources=await database.request('GET','fuentes_datos',params={'codigo':'eq.igp','select':'limites','limit':'1'})
    flags=sources[0].get('limites',{}) if isinstance(sources,list) and sources else {}
    if flags.get('sms_habilitada') is not True: return {'estado':'apagadas','aceptadas':0}
    if not sms_provider.configured: raise RuntimeError('Falta configurar SMS de Twilio en el ejecutor de sincronización.')
    if flags.get('sms_cuenta')!=sms_provider.account_hash: raise RuntimeError('La cuenta Twilio del ejecutor no coincide con la autorizada.')
    numbers=await sms_provider.recipients()  # Also verifies the account is still Trial.
    pending=await database.request('GET','entregas_alerta',params={'select':'id,proveedor_mensaje_id','canal':'eq.sms',
        'sms_cuenta_hash':'eq.'+sms_provider.account_hash,'estado_proveedor':'in.(accepted,queued,sending,sent)','limit':'20'})
    semaphore=asyncio.Semaphore(5)
    async def refresh(row):
        async with semaphore:
            try: state=await sms_provider.status(row['proveedor_mensaje_id'])
            except VoiceError: return
            await database.request('POST','rpc/sismocore_actualizar_sms_automatico',data={
                'p_id':row['id'],'p_sid':row['proveedor_mensaje_id'],'p_estado':state})
    await asyncio.gather(*(refresh(row) for row in pending))
    await database.request('POST','rpc/sismocore_evaluar_reglas_push',data={})
    claim=await database.request('POST','rpc/sismocore_reservar_sms_automatico',data={'p_cuenta':sms_provider.account_hash})
    if not claim: return {'estado':'sin_sms_disponible','aceptadas':0}
    valid=await database.request('POST','rpc/sismocore_validar_envio_sms',data={
        'p_id':claim['id'],'p_reserva':claim['reserva_id'],'p_cuenta':sms_provider.account_hash})
    result=None;error=None
    try:
        if not valid: raise VoiceError('CONSENTIMIENTO_CAMBIADO')
        phone=numbers.get(claim['destino'])
        if not phone: raise VoiceError('DESTINO_NO_DISPONIBLE')
        result=await sms_provider.send_test(phone)
    except VoiceError as failure: error=failure.code
    state=result['estado'] if result else 'desconocida' if error in ('CONEXION','RESPUESTA_INVALIDA') else 'rechazada'
    await database.request('POST','rpc/sismocore_finalizar_sms_automatico',data={
        'p_id':claim['id'],'p_reserva':claim['reserva_id'],'p_estado':state,'p_sid':result['sid'] if result else None,'p_error':error})
    return {'estado':state,'aceptadas':1 if result else 0}
