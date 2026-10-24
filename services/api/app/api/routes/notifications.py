from uuid import UUID
import json

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr

from app.api.routes.auth import guard
from app.services.database import database, DatabaseError
from app.services.permissions import require_permission
from app.services.push import push_sender, PushError

router = APIRouter(prefix='/notificaciones',tags=['Notificaciones personales'])
METADATA = 'id,etiqueta,activo,registrado_en,actualizado_en,ultima_prueba_en,ultima_prueba_estado,ultimo_error_codigo'
own_notifications = require_permission('notificaciones.propias')


class Registration(BaseModel):
    model_config = ConfigDict(extra='forbid')
    token: SecretStr = Field(min_length=50,max_length=4096)
    etiqueta: str = Field(min_length=1,max_length=80)


async def rpc(name, data):
    try:
        return await database.request('POST',f'rpc/{name}',data=data)
    except DatabaseError as exc:
        messages = {'PT403':(403,'Tu cuenta no está activa.'),'PT404':(404,'Este dispositivo ya no está registrado. Activa las notificaciones de nuevo.'),
                    'PT409':(409,'Alcanzaste el máximo de diez dispositivos activos.'),'PT422':(422,'Revisa los datos del dispositivo.'),
                    'PT429':(429,'Espera un minuto antes de enviar otra prueba.')}
        if exc.code=='PT409' and name=='sismocore_guardar_regla_push':
            raise HTTPException(409,'No se pudo guardar la regla. Actualiza la lista y revisa que la fuente IGP esté activa; se permiten hasta veinte reglas.') from exc
        if exc.code=='PT422' and name=='sismocore_guardar_regla_push':
            raise HTTPException(422,'Revisa la magnitud, la zona y los destinatarios. Todos deben tener una cuenta activa.') from exc
        if exc.code in messages:
            status,message = messages[exc.code]
            raise HTTPException(status,message) from exc
        raise


@router.get('')
async def status(user=Depends(own_notifications)):
    rows = await database.request('GET','dispositivos_notificacion',params={
        'select':METADATA,'usuario_id':f'eq.{user["id"]}','activo':'eq.true','order':'actualizado_en.desc','limit':'10'})
    rules=await database.request('GET','reglas_alerta',params={'select':'id','activa':'eq.true','canales':'eq.{push}',
        'destinatarios':'cs.'+json.dumps([user['id']]),'limit':'1'})
    return {'configurada':push_sender.configured,
            'dispositivos':[{key:row.get(key) for key in METADATA.split(',')} for row in rows],
            'automaticas_activas':bool(rules)}


@router.post('/dispositivos')
async def register(body: Registration, request: Request, user=Depends(own_notifications)):
    guard(request,'push')
    result = await rpc('sismocore_registrar_dispositivo',{'p_usuario_id':user['id'],'p_token':body.token.get_secret_value(),
        'p_etiqueta':body.etiqueta.strip(),'p_correlacion_id':request.state.correlation_id})
    # Defensive allowlist: RPC changes must never expose a raw registration token.
    return {'dispositivo':{key:result.get(key) for key in METADATA.split(',')}}


@router.post('/dispositivos/{device_id}/desactivar')
async def deactivate(device_id: UUID, request: Request, user=Depends(own_notifications)):
    guard(request,'push')
    await rpc('sismocore_desactivar_dispositivo',{'p_usuario_id':user['id'],'p_dispositivo_id':str(device_id),
        'p_correlacion_id':request.state.correlation_id})
    return {'message':'Notificaciones desactivadas para este dispositivo.'}


@router.post('/dispositivos/{device_id}/prueba')
async def test(device_id: UUID, request: Request, user=Depends(own_notifications)):
    guard(request,'push')
    if not push_sender.configured:
        raise HTTPException(503,'Falta configurar la credencial privada de Firebase en el servidor. Aún no se pueden enviar pruebas.')
    claimed = await rpc('sismocore_preparar_prueba_push',{'p_usuario_id':user['id'],
        'p_dispositivo_id':str(device_id),'p_correlacion_id':request.state.correlation_id})
    error = None
    message_id = None
    try:
        message_id = await push_sender.test(claimed['token'],request.state.correlation_id,request.headers['origin'])
    except PushError as failure:
        error = failure.code
    try:
        await rpc('sismocore_finalizar_prueba_push',{'p_usuario_id':user['id'],'p_dispositivo_id':str(device_id),
            'p_prueba_id':claimed['prueba_id'],'p_aceptada':error is None,'p_error_codigo':error,'p_mensaje_id':message_id})
    except DatabaseError as failure:
        raise HTTPException(503,'La solicitud se procesó, pero no se pudo confirmar su registro. Espera antes de volver a probar.') from failure
    if error:
        messages = {'UNREGISTERED':'El registro del navegador venció. Vuelve a activar las notificaciones.',
                    'AUTHENTICATION_ERROR':'Revisa la credencial privada de Firebase en el servidor.',
                    'PERMISSION_DENIED':'Firebase rechazó el envío. Revisa el proyecto, la API FCM y los permisos de la cuenta de servicio.'}
        raise HTTPException(503,messages.get(error,'No se pudo confirmar el envío. Espera un minuto antes de volver a probar.'))
    return {'message':'Firebase aceptó la notificación de prueba. Comprueba su recepción en este dispositivo.',
            'estado':'aceptada','correlacion_id':request.state.correlation_id}
