import asyncio
import importlib.util
from datetime import date,datetime,timedelta,timezone
from typing import Literal
from uuid import UUID,uuid4
from fastapi import APIRouter,Depends,HTTPException,Request,Query
from pydantic import BaseModel,ConfigDict,Field,model_validator
from app.api.routes.auth import guard
from app.services.database import database,DatabaseError
from app.services.permissions import require_permission
from app.services import ml_engine as engine,ml_storage as storage

router=APIRouter(prefix='/modelos',tags=['Laboratorio de aprendizaje supervisado'])
read=require_permission('modelos.leer');write=require_permission('modelos.entrenar');approve=require_permission('modelos.aprobar')
DATA_FIELDS='id,nombre,version,estado,periodo_inicio,periodo_fin,numero_filas,informe_calidad,particion_temporal,creado_en,creado_por,publicado_en,snapshot_sha256'
MODEL_FIELDS='id,nombre,version,dataset_id,objetivo,tarea,algoritmo,features,target,hiperparametros,semilla,versiones_librerias,validacion,metricas,baseline,estado,limitaciones,error_resumen,creado_por,creado_en,entrenamiento_inicio,entrenamiento_fin,aprobado_por,aprobado_en,artefacto_sha256'


class DatasetInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    nombre:str=Field(min_length=2,max_length=80,pattern=r'^\S(?:.*\S)?$')
    desde:date
    hasta:date
    region:str | None=Field(default=None,max_length=120)
    fraccion:Literal[0.7,0.8]=0.8
    confirmado:Literal[True]

    @model_validator(mode='after')
    def window(self):
        if self.hasta<self.desde or (self.hasta-self.desde).days>366 or self.hasta>datetime.now(timezone.utc).date():raise ValueError('Periodo inválido')
        return self


class TrainInput(BaseModel):
    model_config=ConfigDict(extra='forbid')
    nombre:str=Field(min_length=2,max_length=80,pattern=r'^\S(?:.*\S)?$')
    dataset_id:UUID
    algoritmo:Literal['lineal_simple','lineal_multiple','logistica']
    semilla:int=Field(default=42,ge=0,le=2147483647)
    confirmado:Literal[True]


class Confirm(BaseModel):
    model_config=ConfigDict(extra='forbid')
    confirmado:Literal[True]


class Variables(BaseModel):
    model_config=ConfigDict(extra='forbid')
    magnitud:float=Field(ge=0,le=10,allow_inf_nan=False)
    latitud:float=Field(ge=-90,le=90,allow_inf_nan=False)
    longitud:float=Field(ge=-180,le=180,allow_inf_nan=False)


async def rpc(name,data):
    try:return await database.request('POST','rpc/'+name,data=data)
    except DatabaseError as failure:
        if failure.code in ('PT403','PT409','PT422'):
            raise HTTPException({'PT403':403,'PT409':409,'PT422':422}[failure.code],
                'La operación no está disponible. Revisa el estado, permisos y límites: 50 datasets, 100 modelos; hasta 5 datasets y 10 entrenamientos diarios por usuario; un entrenamiento simultáneo.',
                headers={'X-Permission-Denied':'true'} if failure.code=='PT403' else None) from None
        raise


async def dataset_row(dataset_id):
    rows=await database.request('GET','datasets',params={'id':'eq.'+str(dataset_id),'select':'*','limit':'1'})
    if not rows:raise HTTPException(404,'Dataset no encontrado.')
    return rows[0]


async def model_row(model_id):
    rows=await database.request('GET','modelos_ml',params={'id':'eq.'+str(model_id),'select':'*','limit':'1'})
    if not rows:raise HTTPException(404,'Modelo no encontrado.')
    return rows[0]


def public(row,fields):return {key:row.get(key) for key in fields.split(',')}


async def verified_snapshot(row):
    snapshot=await storage.download(row['snapshot_path'],row['snapshot_sha256'])
    if not isinstance(snapshot,dict) or snapshot.get('formato')!='sismocore-dataset-v1' or snapshot.get('id')!=row['id'] or len(snapshot.get('filas',[]))!=row['numero_filas'] or snapshot.get('particion')!=row['particion_temporal']:
        raise storage.ArtifactError('La copia privada no corresponde al dataset registrado.')
    return snapshot


@router.get('')
async def list_models(pagina:int=Query(1,ge=1),tamano:int=Query(20,ge=1,le=100),dataset_id:UUID | None=None,user=Depends(read)):
    params={'select':MODEL_FIELDS,'order':'creado_en.desc,id','limit':str(tamano),'offset':str((pagina-1)*tamano)}
    if dataset_id:params['dataset_id']='eq.'+str(dataset_id)
    models,total=await database.page('modelos_ml',params=params)
    datasets=await database.request('GET','datasets',params={'select':DATA_FIELDS,'order':'creado_en.desc,id','limit':'50'})
    return {'modelos':models,'total':total,'pagina':pagina,'datasets':datasets,'disponible':importlib.util.find_spec('sklearn') is not None,'advertencia':engine.DISCLAIMER}


@router.post('/datasets',status_code=201)
async def create_dataset(body:DatasetInput,request:Request,user=Depends(write)):
    guard(request,'ml')
    cutoff=datetime.now(timezone.utc).isoformat();rows=[];offset=0
    end=min((datetime.combine(body.hasta,datetime.min.time(),tzinfo=timezone.utc)+timedelta(days=1)).isoformat(),cutoff)
    while True:
        params={'select':'id,id_externo,magnitud,profundidad,latitud,longitud,region,ocurrido_en,hash_origen,fuente:fuentes_datos!inner(codigo)',
            'fuente.codigo':'eq.igp','and':f'(ocurrido_en.gte.{body.desde.isoformat()}T00:00:00Z,ocurrido_en.lt.{end})',
            'recibido_en':'lte.'+cutoff,'order':'ocurrido_en.asc,id','limit':'1000','offset':str(offset)}
        if body.region:params['region']='eq.'+body.region
        page=await database.request('GET','eventos_sismicos',params=params)
        rows.extend(page)
        if len(rows)>5000:raise HTTPException(422,'Hay más de 5000 registros. Reduce el periodo o selecciona una región.')
        if len(page)<1000:break
        offset+=len(page)
    try:
        snapshot=engine.prepare(rows,body.fraccion,cutoff)
        identity=str(uuid4());path='datasets/'+identity+'.json'
        snapshot['id']=identity
        checksum=await storage.upload(path,snapshot)
    except (engine.DataError,storage.ArtifactError) as failure:raise HTTPException(422,str(failure)) from None
    info={'snapshot_path':path,'snapshot_sha256':checksum,'numero_filas':len(snapshot['filas']),
        'periodo_inicio':body.desde.isoformat()+'T00:00:00Z','periodo_fin':end,
        'especificacion':{'fuente':'igp','desde':body.desde.isoformat(),'hasta':body.hasta.isoformat(),'region':body.region,'corte':cutoff,'pipeline_version':1},
        'informe_calidad':snapshot['calidad'],'particion_temporal':snapshot['particion'],
        'transformaciones':['Descartar registros incompletos o fuera de rango; sin imputación.','Deduplicar por ID IGP; conservar eventos diferentes con coordenadas iguales.','Ordenar por fecha UTC e ID; separar fechas completas sin mezcla aleatoria.']}
    result=await rpc('sismocore_crear_dataset_ml',{'p_actor':user['id'],'p_id':identity,'p_nombre':body.nombre,'p_info':info,'p_correlacion':request.state.correlation_id})
    return {'dataset':public(result,DATA_FIELDS)}


@router.get('/datasets/{dataset_id}')
async def dataset_detail(dataset_id:UUID,user=Depends(read)):
    row=await dataset_row(dataset_id)
    try:snapshot=await verified_snapshot(row)
    except storage.ArtifactError as failure:raise HTTPException(503,str(failure)) from None
    return {'dataset':public(row,DATA_FIELDS),'vista_previa':snapshot['filas'][:20],'transformaciones':row['transformaciones']}


@router.post('/datasets/{dataset_id}/publicar')
async def publish_dataset(dataset_id:UUID,body:Confirm,request:Request,user=Depends(approve)):
    guard(request,'ml')
    row=await dataset_row(dataset_id)
    try:await verified_snapshot(row)
    except storage.ArtifactError as failure:raise HTTPException(503,str(failure)) from None
    result=await rpc('sismocore_publicar_dataset_ml',{'p_actor':user['id'],'p_id':str(dataset_id),'p_correlacion':request.state.correlation_id})
    return {'dataset':public(result,DATA_FIELDS)}


@router.post('/experimentos',status_code=201)
async def train_model(body:TrainInput,request:Request,user=Depends(write)):
    guard(request,'ml')
    row=await dataset_row(body.dataset_id)
    if row['estado']!='publicado':raise HTTPException(422,'El administrador debe publicar el dataset antes de entrenar.')
    try:snapshot=await verified_snapshot(row)
    except storage.ArtifactError as failure:raise HTTPException(503,str(failure)) from None
    identity=str(uuid4())
    await rpc('sismocore_reservar_modelo_ml',{'p_actor':user['id'],'p_id':identity,'p_dataset':str(body.dataset_id),'p_nombre':body.nombre,
        'p_algoritmo':body.algoritmo,'p_semilla':body.semilla,'p_correlacion':request.state.correlation_id})
    try:
        async with asyncio.timeout(120):
            output=await asyncio.to_thread(engine.train,snapshot,body.algoritmo,body.semilla)
            artifact=output.pop('artefacto')|{'id':identity,'dataset_id':row['id'],'dataset_sha256':row['snapshot_sha256']}
            path='modelos/'+identity+'.json'
            checksum=await storage.upload(path,artifact)
            result=await rpc('sismocore_finalizar_modelo_ml',{'p_actor':user['id'],'p_id':identity,
                'p_resultado':output|{'estado':'evaluado','artefacto_path':path,'artefacto_sha256':checksum},'p_correlacion':request.state.correlation_id})
    except Exception as failure:
        # A lost success response must never overwrite an already evaluated model.
        try:await rpc('sismocore_finalizar_modelo_ml',{'p_actor':user['id'],'p_id':identity,'p_resultado':{'estado':'fallido'},'p_correlacion':request.state.correlation_id})
        except Exception:pass
        message=str(failure) if isinstance(failure,(engine.DataError,storage.ArtifactError)) else 'No se completó el entrenamiento. Actualiza el historial antes de repetirlo.'
        raise HTTPException(422 if isinstance(failure,engine.DataError) else 503,message) from None
    return {'modelo':public(result,MODEL_FIELDS)}


@router.get('/{model_id}')
async def model_detail(model_id:UUID,user=Depends(read)):
    return {'modelo':public(await model_row(model_id),MODEL_FIELDS)}


@router.post('/{model_id}/aprobar')
async def approve_model(model_id:UUID,body:Confirm,request:Request,user=Depends(approve)):
    guard(request,'ml');row=await model_row(model_id)
    try:
        artifact=await storage.download(row['artefacto_path'],row['artefacto_sha256'])
        if not isinstance(artifact,dict) or artifact.get('id')!=str(model_id) or artifact.get('dataset_id')!=row['dataset_id'] or artifact.get('dataset_sha256')!=row['validacion'].get('dataset_sha256'):raise storage.ArtifactError('Identidad de modelo inválida.')
    except (storage.ArtifactError,TypeError):raise HTTPException(503,'No se pudo validar el artefacto del modelo.') from None
    result=await rpc('sismocore_aprobar_modelo_ml',{'p_actor':user['id'],'p_id':str(model_id),'p_correlacion':request.state.correlation_id})
    return {'modelo':public(result,MODEL_FIELDS)}


@router.post('/{model_id}/estimar')
async def estimate(model_id:UUID,body:Variables,request:Request,user=Depends(read)):
    guard(request,'ml');row=await model_row(model_id)
    if row['estado']!='aprobado':raise HTTPException(409,'Solo se pueden consultar modelos aprobados para uso experimental.')
    try:
        artifact=await storage.download(row['artefacto_path'],row['artefacto_sha256'])
        if artifact.get('id')!=str(model_id) or artifact.get('dataset_id')!=row['dataset_id'] or artifact.get('dataset_sha256')!=row['validacion'].get('dataset_sha256'):raise engine.DataError('El artefacto no corresponde al modelo.')
        result=await asyncio.to_thread(engine.infer,artifact,body.model_dump())
    except (storage.ArtifactError,engine.DataError) as failure:raise HTTPException(503,str(failure)) from None
    return {'modelo_id':str(model_id),'version':row['version'],'dataset_id':row['dataset_id'],'calculado_en':datetime.now(timezone.utc).isoformat(),'resultado':result}
