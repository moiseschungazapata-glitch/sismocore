from uuid import UUID
from fastapi import APIRouter,Depends,Request,HTTPException
from app.api.routes.auth import guard
from app.api.routes.voice import CallRequest
from app.services.permissions import require_permission
from app.services.database import database,DatabaseError
from app.services.voice import VoiceError
from app.services.sms import sms_provider

router=APIRouter(prefix='/sms',tags=['Pruebas SMS'])
admin=require_permission('voz.probar')


def provider_error(error):
    messages={'CUENTA_NO_TRIAL':'SMS de prueba bloqueado: esta integración solo permite cuentas Trial para evitar cargos de una cuenta de pago.',
        '10002':'Tu cuenta Trial no admite esta función SMS por API. Revisa Try out SMS en Twilio.',
        '21608':'Twilio requiere verificar el teléfono de destino antes de enviar SMS.',
        '21408':'Twilio no permite enviar SMS a ese país con la configuración actual.',
        '21612':'Twilio no admite esta combinación de remitente y destinatario SMS.',
        '21606':'El remitente no está habilitado para SMS. Completa la prueba en Try out SMS de Twilio.',
        '21604':'Falta configurar el remitente SMS. Completa primero Try out SMS y revisa la solicitud que muestra Twilio.',
        '20003':'Twilio rechazó la credencial del servidor.',
        'CONEXION':'No se pudo confirmar el envío. Puede que Twilio lo haya aceptado; revisa sus registros antes de repetirlo.',
        'RESPUESTA_INVALIDA':'Twilio respondió sin un resultado válido. Revisa sus registros antes de repetir el SMS.'}
    return HTTPException(503,messages.get(error.code,'Twilio rechazó o no confirmó el SMS. Revisa Try out SMS y sus registros antes de repetirlo.'))


async def rpc(name,data):
    try:return await database.request('POST','rpc/'+name,data=data)
    except DatabaseError as error:
        messages={'PT429':(429,'Espera un minuto antes de enviar otro SMS.'),'PT409':(409,'Se alcanzó el límite de SISMOCORE: cinco SMS por día y cincuenta en total.'),'PT404':(404,'Esta prueba SMS no pertenece a tu cuenta.'),'PT403':(403,'Solo administración activa puede enviar SMS de prueba.')}
        if error.code in messages:
            status,message=messages[error.code];raise HTTPException(status,message) from error
        raise


async def history(user):
    claims=await database.request('GET','auditoria',params={'select':'id,ocurrido_en,despues','actor_id':'eq.'+user['id'],
        'accion':'eq.sms.solicitar','entidad':'eq.sms_pruebas','despues->>cuenta':'eq.'+sms_provider.account_hash,'order':'ocurrido_en.desc,id','limit':'10'})
    if not claims:return []
    states=await database.request('GET','auditoria',params={'select':'entidad_id,despues','actor_id':'eq.'+user['id'],
        'accion':'eq.sms.estado','entidad_id':'in.('+','.join(row['id'] for row in claims)+')','order':'ocurrido_en.desc,id','limit':'100'})
    latest={}
    for row in states:latest.setdefault(row['entidad_id'],row['despues'])
    return [{'id':row['id'],'fecha':row['ocurrido_en'],'ultimos':row['despues']['ultimos'],
        'estado':latest.get(row['id'],{}).get('estado','solicitada'),'sid':latest.get(row['id'],{}).get('proveedor_id')} for row in claims]


@router.get('/pruebas')
async def settings(user=Depends(admin)):
    if not sms_provider.configured:return {'configurada':False,'destinatarios':[],'historial':[],'limites':None}
    try:numbers=await sms_provider.recipients()
    except VoiceError as error:raise provider_error(error) from error
    limits=await rpc('sismocore_limites_sms',{'p_cuenta':sms_provider.account_hash})
    return {'configurada':True,'destinatarios':[{'id':key,'etiqueta':'Perú · celular terminado en '+value[-4:]} for key,value in sorted(numbers.items())],
        'historial':[{key:value for key,value in row.items() if key!='sid'} for row in await history(user)],'limites':limits}


@router.post('/pruebas')
async def send(body:CallRequest,request:Request,user=Depends(admin)):
    guard(request,'sms')
    try:numbers=await sms_provider.recipients()
    except VoiceError as error:raise provider_error(error) from error
    phone=numbers.get(body.destino_id)
    if not phone:raise HTTPException(422,'Selecciona un destinatario disponible. Verifícalo primero en Twilio y actualiza la lista.')
    ref=request.state.correlation_id
    await rpc('sismocore_reservar_prueba_sms',{'p_actor':user['id'],'p_cuenta':sms_provider.account_hash,'p_destino':body.destino_id,'p_ultimos':phone[-4:],'p_referencia':ref})
    result=None;error=None
    try:result=await sms_provider.send_test(phone)
    except VoiceError as failure:error=failure
    state=result['estado'] if result else 'desconocida' if error.code in ('CONEXION','RESPUESTA_INVALIDA') else 'rechazada'
    try:await rpc('sismocore_registrar_estado_sms',{'p_actor':user['id'],'p_referencia':ref,'p_estado':state,'p_sid':result['sid'] if result else None,'p_error':error.code if error else None})
    except DatabaseError as failure:raise HTTPException(503,'La solicitud se procesó pero no se pudo registrar su resultado. Consulta Twilio antes de repetir el SMS.') from failure
    if error:raise provider_error(error) from error
    return {'id':ref,'estado':state,'message':'Twilio aceptó el SMS de prueba. Consulta el estado y comprueba su recepción en el teléfono seleccionado.'}


@router.post('/pruebas/{reference}/actualizar')
async def update(reference:UUID,request:Request,user=Depends(admin)):
    guard(request,'sms')
    row=next((item for item in await history(user) if item['id']==str(reference)),None)
    if not row:raise HTTPException(404,'Esta prueba SMS no está disponible en tu historial reciente.')
    if not row['sid'] or row['estado'] in ('delivered','undelivered','failed','canceled'):return {'estado':row['estado']}
    try:state=await sms_provider.status(row['sid'])
    except VoiceError as error:raise provider_error(error) from error
    if state!=row['estado']:await rpc('sismocore_registrar_estado_sms',{'p_actor':user['id'],'p_referencia':str(reference),'p_estado':state,'p_sid':row['sid'],'p_error':None})
    return {'estado':state}
