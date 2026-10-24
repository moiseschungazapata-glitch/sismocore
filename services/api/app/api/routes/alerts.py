from uuid import UUID
from typing import Annotated
from fastapi import APIRouter, Depends, Request, Query, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.api.routes.auth import guard
from app.api.routes.notifications import rpc
from app.services.database import database
from app.services.permissions import require_permission, permissions_for

router=APIRouter(prefix='/alertas',tags=['Reglas y avisos'])
manage=require_permission('alertas.administrar')
own=require_permission('notificaciones.propias')
RULE_FIELDS='id,nombre,version,magnitud_minima,zona,destinatarios,activa,vigente_desde,actualizado_en'


class Zone(BaseModel):
    model_config=ConfigDict(extra='forbid')
    latitud:float=Field(ge=-90,le=90,allow_inf_nan=False)
    longitud:float=Field(ge=-180,le=180,allow_inf_nan=False)
    radio_km:float=Field(ge=10,le=2000,allow_inf_nan=False)


class Rule(BaseModel):
    model_config=ConfigDict(extra='forbid')
    nombre:str=Field(min_length=1,max_length=80)
    magnitud_minima:float=Field(ge=0,le=10,allow_inf_nan=False)
    zona:Zone | None=None
    destinatarios:Annotated[list[UUID],Field(min_length=1,max_length=50)]
    activa:bool=False
    version:int | None=Field(default=None,ge=1)

    @model_validator(mode='after')
    def clean(self):
        self.nombre=self.nombre.strip()
        if not self.nombre or len(set(self.destinatarios))!=len(self.destinatarios): raise ValueError('Regla invalida')
        return self


@router.get('/reglas')
async def rules(user=Depends(manage)):
    rows=await database.request('GET','reglas_alerta',params={'select':RULE_FIELDS,'canales':'eq.{push}','order':'creado_en.desc','limit':'20'})
    recipients=await database.request('GET','perfiles',params={'select':'id,nombre_completo,rol','estado':'eq.activo','order':'nombre_completo,id','limit':'200'})
    return {'reglas':rows,'destinatarios':recipients}


async def save(body,request,user,rule_id=None):
    guard(request,'push')
    data=await rpc('sismocore_guardar_regla_push',{'p_actor':user['id'],'p_id':str(rule_id) if rule_id else None,
        'p_nombre':body.nombre,'p_magnitud':body.magnitud_minima,'p_zona':body.zona.model_dump() if body.zona else {},
        'p_destinatarios':[str(value) for value in body.destinatarios],'p_activa':body.activa,'p_version':body.version,
        'p_correlacion':request.state.correlation_id})
    return {'regla':{key:data.get(key) for key in RULE_FIELDS.split(',')}}


@router.post('/reglas')
async def create(body:Rule,request:Request,user=Depends(manage)):
    return await save(body,request,user)


@router.patch('/reglas/{rule_id}')
async def update(rule_id:UUID,body:Rule,request:Request,user=Depends(manage)):
    return await save(body,request,user,rule_id)


@router.get('/historial')
async def history(alcance:str=Query('propias',pattern='^(propias|todas)$'),user=Depends(own)):
    if alcance=='todas' and 'alertas.administrar' not in permissions_for(user['rol']):
        raise HTTPException(403,'Tu rol solo puede consultar sus propios avisos.',headers={'X-Permission-Denied':'true'})
    params={'select':'id,estado,creado_en,ultimo_intento_en,error_codigo,intentos,usuario:perfiles!entregas_alerta_usuario_id_fkey(nombre_completo),dispositivo:dispositivos_notificacion(etiqueta),alerta:alertas(titulo,mensaje,url_fuente,contexto)',
        'canal':'eq.push','order':'creado_en.desc,id','limit':'50'}
    if alcance=='propias': params['usuario_id']=f'eq.{user["id"]}'
    rows=await database.request('GET','entregas_alerta',params=params)
    return {'entregas':rows}
