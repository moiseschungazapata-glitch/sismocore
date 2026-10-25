"""Consent-based Trial calls. One reservation per cycle; no uncertain retries."""
import asyncio
import math
from datetime import datetime,timedelta,timezone
from xml.etree.ElementTree import Element,SubElement,tostring
from app.services.database import database
from app.services.voice import voice_provider,VoiceError


def event_twiml(context, *, latest=False):
    magnitude=float(context['magnitud'])
    if not math.isfinite(magnitude) or not 0<=magnitude<=10: raise ValueError('Magnitud invalida')
    date=datetime.fromisoformat(context['ocurrido_en'].replace('Z','+00:00'))
    if date.tzinfo is None: raise ValueError('Fecha sin zona')
    date=date.astimezone(timezone(timedelta(hours=-5)))
    months=('enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre')
    place=str(context['lugar'])[:120]
    magnitude=f'{magnitude:.1f}'.replace('.',' coma ')
    root=Element('Response')
    say=SubElement(root,'Say',{'voice':'man','language':'es'})
    opening='Último evento registrado en SISMOCORE.' if latest else 'Aviso de SISMOCORE.'
    clock=date.strftime('%H:%M:%S' if latest else '%H:%M')
    depth=f"Profundidad de {float(context['profundidad']):g} kilómetros. " if latest else ''
    say.text=(f'{opening} El IGP reportó un sismo de magnitud {magnitude}. {place}. '
        f'Ocurrió el {date.day} de {months[date.month-1]} de {date.year}, a las {clock}, hora de Perú. '+depth+
        'Es un evento ya ocurrido. No es una predicción ni una alerta oficial.')
    SubElement(root,'Hangup')
    return tostring(root,encoding='utf-8',xml_declaration=True)


async def process_automatic_calls():
    sources=await database.request('GET','fuentes_datos',params={'codigo':'eq.igp','select':'limites','limit':'1'})
    flags=sources[0].get('limites',{}) if isinstance(sources,list) and sources else {}
    if flags.get('voz_habilitada') is not True: return {'estado':'apagadas','aceptadas':0}
    if not voice_provider.configured: raise RuntimeError('Falta configurar Twilio en el ejecutor de sincronización.')
    if flags.get('voz_cuenta')!=voice_provider.account_hash: raise RuntimeError('La cuenta Twilio del ejecutor no coincide con la autorizada.')
    numbers=await voice_provider.recipients()  # Also verifies the account is still Trial.
    pending=await database.request('GET','entregas_alerta',params={'select':'id,proveedor_mensaje_id','canal':'eq.voz',
        'voz_cuenta_hash':'eq.'+voice_provider.account_hash,'estado_proveedor':'in.(queued,initiated,ringing,in-progress)','limit':'20'})
    semaphore=asyncio.Semaphore(5)
    async def refresh(row):
        async with semaphore:
            try: state=await voice_provider.status(row['proveedor_mensaje_id'])
            except VoiceError: return
            await database.request('POST','rpc/sismocore_actualizar_llamada_automatica',data={
                'p_id':row['id'],'p_sid':row['proveedor_mensaje_id'],'p_estado':state})
    await asyncio.gather(*(refresh(row) for row in pending))
    await database.request('POST','rpc/sismocore_evaluar_reglas_push',data={})
    claim=await database.request('POST','rpc/sismocore_reservar_llamada_automatica',data={'p_cuenta':voice_provider.account_hash})
    if not claim: return {'estado':'sin_llamada_disponible','aceptadas':0}
    context=await database.request('POST','rpc/sismocore_contenido_llamada',data={
        'p_id':claim['id'],'p_clave':claim['reserva_id'],'p_cuenta':voice_provider.account_hash})
    result=None;error=None
    try:
        if not context: raise VoiceError('CONSENTIMIENTO_CAMBIADO')
        event_twiml(context)  # Validate the snapshot before consuming a real call.
        phone=numbers.get(claim['destino'])
        if not phone: raise VoiceError('DESTINO_NO_DISPONIBLE')
        result=await voice_provider.call_event(phone,claim['id'],claim['reserva_id'])
    except VoiceError as failure: error=failure.code
    except (ValueError,TypeError,KeyError): error='CONTEXTO_INVALIDO'
    state=result['estado'] if result else 'desconocida' if error in ('CONEXION','RESPUESTA_INVALIDA') else 'rechazada'
    await database.request('POST','rpc/sismocore_finalizar_llamada_automatica',data={
        'p_id':claim['id'],'p_reserva':claim['reserva_id'],'p_estado':state,'p_sid':result['sid'] if result else None,'p_error':error})
    return {'estado':state,'aceptadas':1 if result else 0}
