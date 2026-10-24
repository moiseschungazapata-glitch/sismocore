from uuid import UUID
from typing import Literal
from fastapi import APIRouter, Response, Depends, Request, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from app.api.routes.auth import guard
from app.services.database import database, DatabaseError
from app.services.permissions import require_permission
from app.services.voice import voice_provider, VoiceError

router = APIRouter(prefix='/voz', tags=['Prueba de voz'])
admin = require_permission('voz.probar')

# Public, fixed instructions for Twilio's Custom TwiML URL. Fetching this endpoint
# never initiates calls, consumes provider credentials or accepts spoken user text.
TRIAL_TWIML = '''<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="man" language="es">Esta es una prueba de SISMOCORE. No representa una alerta sísmica real.</Say>
  <Hangup/>
</Response>'''


@router.api_route('/prueba.xml', methods=['GET', 'POST'], response_class=Response)
async def trial_instructions():
    return Response(content=TRIAL_TWIML, media_type='application/xml')


class CallRequest(BaseModel):
    model_config=ConfigDict(extra='forbid')
    destino_id:str=Field(pattern=r'^[a-f0-9]{64}$')
    confirmado:Literal[True]


def provider_error(failure):
    messages={
        'SIN_CONFIGURACION':'Falta completar la configuración privada de Twilio en este servidor.',
        'CUENTA_NO_TRIAL':'Esta integración de pruebas solo permite cuentas Trial. Las llamadas están bloqueadas para evitar cargos de una cuenta de pago.',
        'CUENTA_INACTIVA':'La cuenta de Twilio no está activa. Revisa su estado en la consola.',
        '20003':'Twilio rechazó la credencial. Revisa la configuración privada del servidor.',
        '21210':'Twilio no permite usar ese remitente en la cuenta Trial.',
        '21212':'El remitente configurado no es válido para Twilio.',
        '21219':'Twilio requiere verificar el teléfono de destino.',
        '21215':'Twilio no permite llamar a este destino con la configuración actual.',
        '21408':'Twilio no permite llamadas al país de destino con la configuración actual.',
        'URL_INVALIDA':'Revisa la dirección pública HTTPS de SISMOCORE en el servidor.',
    }
    return HTTPException(503,messages.get(failure.code,'Twilio no confirmó la operación. Revisa su consola antes de repetir la prueba.'))


async def voice_rpc(name,data):
    try: return await database.request('POST','rpc/'+name,data=data)
    except DatabaseError as failure:
        messages={'PT403':(403,'Solo un administrador activo puede realizar esta prueba.'),
            'PT404':(404,'No se encontró esta prueba en tu cuenta.'),'PT429':(429,'Espera un minuto antes de realizar otra llamada.'),
            'PT409':(409,'Se alcanzó el límite de pruebas de SISMOCORE: cinco intentos por día y cincuenta en total.')}
        if failure.code in messages:
            status,message=messages[failure.code]
            raise HTTPException(status,message) from failure
        raise


async def history_for(user):
    claims=await database.request('GET','auditoria',params={'select':'id,ocurrido_en,despues','actor_id':'eq.'+user['id'],
        'accion':'eq.voz.solicitar','despues->>cuenta':'eq.'+voice_provider.account_hash,'order':'ocurrido_en.desc,id','limit':'10'})
    if not claims: return []
    states=await database.request('GET','auditoria',params={'select':'entidad_id,despues,ocurrido_en','actor_id':'eq.'+user['id'],
        'accion':'eq.voz.estado','entidad_id':'in.('+','.join(row['id'] for row in claims)+')','order':'ocurrido_en.desc,id','limit':'100'})
    latest={}
    for row in states: latest.setdefault(row['entidad_id'],row['despues'])
    return [{'id':row['id'],'fecha':row['ocurrido_en'],'ultimos':row['despues']['ultimos'],
        'estado':latest.get(row['id'],{}).get('estado','solicitada'),'proveedor_id':latest.get(row['id'],{}).get('proveedor_id')}
        for row in claims]


@router.get('/pruebas')
async def test_settings(user=Depends(admin)):
    if not voice_provider.configured:
        return {'configurada':False,'destinatarios':[],'historial':[],'limites':None,'automaticas':False}
    try: numbers=await voice_provider.recipients()
    except VoiceError as failure: raise provider_error(failure) from failure
    limits=await voice_rpc('sismocore_limites_voz',{'p_cuenta':voice_provider.account_hash})
    history=await history_for(user)
    return {'configurada':True,'automaticas':False,'limites':limits,
        'destinatarios':[{'id':key,'etiqueta':'Perú · celular terminado en '+phone[-4:]} for key,phone in sorted(numbers.items())],
        'historial':[{key:value for key,value in row.items() if key!='proveedor_id'} for row in history]}


@router.post('/pruebas')
async def create_test(body:CallRequest,request:Request,user=Depends(admin)):
    guard(request,'voice')
    try: numbers=await voice_provider.recipients()
    except VoiceError as failure: raise provider_error(failure) from failure
    phone=numbers.get(body.destino_id)
    if not phone: raise HTTPException(422,'Selecciona un destino verificado disponible en la lista y actualiza si fuera necesario.')
    reference=request.state.correlation_id
    await voice_rpc('sismocore_reservar_prueba_voz',{'p_actor':user['id'],'p_cuenta':voice_provider.account_hash,
        'p_destino':body.destino_id,'p_ultimos':phone[-4:],'p_referencia':reference})
    error=None;result=None
    try: result=await voice_provider.call(phone)
    except VoiceError as failure: error=failure
    uncertain=error and error.code in ('CONEXION','RESPUESTA_INVALIDA')
    state=result['estado'] if result else 'desconocida' if uncertain else 'rechazada'
    try:
        await voice_rpc('sismocore_registrar_estado_voz',{'p_actor':user['id'],'p_referencia':reference,
            'p_estado':state,'p_sid':result['sid'] if result else None,'p_error':error.code if error else None})
    except DatabaseError as failure:
        raise HTTPException(503,'La solicitud se procesó pero no se pudo guardar su resultado. Consulta Twilio antes de repetirla.') from failure
    if error: raise provider_error(error) from error
    return {'id':reference,'estado':state,'message':'Twilio aceptó la solicitud. Comprueba si recibes la llamada y actualiza su estado; esto no confirma que hayas contestado.'}


@router.post('/pruebas/{reference}/actualizar')
async def update_test(reference:UUID,request:Request,user=Depends(admin)):
    guard(request,'voice')
    row=next((item for item in await history_for(user) if item['id']==str(reference)),None)
    if not row: raise HTTPException(404,'Esta prueba no está disponible en tu historial reciente.')
    if not row['proveedor_id']: return {'estado':row['estado']}
    try: state=await voice_provider.status(row['proveedor_id'])
    except VoiceError as failure: raise provider_error(failure) from failure
    if state!=row['estado']:
        await voice_rpc('sismocore_registrar_estado_voz',{'p_actor':user['id'],'p_referencia':str(reference),
            'p_estado':state,'p_sid':row['proveedor_id'],'p_error':None})
    return {'estado':state}
