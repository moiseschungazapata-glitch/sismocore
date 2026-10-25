import copy
import json
import sys
import unittest
from datetime import datetime,timedelta,timezone
from pathlib import Path
from unittest.mock import AsyncMock,patch

import httpx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from app.services import ml_engine as engine,ml_storage as storage
from app.services.auth import require_user
from app.api.routes.auth import attempts
from main import app

ACTOR='11111111-1111-4111-8111-111111111111'
ID='22222222-2222-4222-8222-222222222222'
CUTOFF='2026-10-25T23:59:59+00:00'


def rows(count=100):
    start=datetime(2026,1,1,tzinfo=timezone.utc)
    return [{'id':str(i),'id_externo':f'2026-{i}', 'ocurrido_en':(start+timedelta(hours=i)).isoformat(),
        'magnitud':2+(i%13)*.2,'latitud':-5-i%15*.4,'longitud':-70-i%9*.3,
        'profundidad':20+(i%17)*24,'region':'Prueba'} for i in range(count)]


class EngineTests(unittest.TestCase):
    def test_cleaning_and_temporal_manifest(self):
        source=rows();source.extend([source[0].copy(),{**source[1],'id_externo':'bad','magnitud':None},
            {**source[1],'id_externo':'future','ocurrido_en':'2027-01-01T00:00:00Z'}]);source.reverse()
        snapshot=engine.prepare(source,.8,CUTOFF)
        self.assertEqual(snapshot['calidad']['validos'],100)
        self.assertEqual(snapshot['calidad']['duplicados'],1)
        self.assertEqual(snapshot['calidad']['descartados'],2)
        p=snapshot['particion'];self.assertEqual((p['entrenamiento'],p['evaluacion']),(80,20))
        self.assertLess(p['fin_entrenamiento'],p['inicio_evaluacion'])
        self.assertEqual(snapshot['calidad']['nulos']['magnitud'],1)

    def test_no_shared_timestamp_at_split(self):
        source=rows();source[80]['ocurrido_en']=source[79]['ocurrido_en']
        snapshot=engine.prepare(source,.8,CUTOFF)
        self.assertEqual(snapshot['particion']['entrenamiento'],81)
        for source in [rows(49),[{**r,'ocurrido_en':rows(1)[0]['ocurrido_en']} for r in rows()]]:
            with self.assertRaises(engine.DataError):engine.prepare(source,.8,CUTOFF)

    def test_no_imputation_of_invalid_numeric_values(self):
        for value in [None,float('nan'),float('inf'),True,-1,1001]:
            source=rows();source[0]['profundidad']=value
            self.assertEqual(engine.prepare(source,.7,CUTOFF)['calidad']['validos'],99)

    def test_scaler_train_only_and_regression_json_inference_parity(self):
        source=rows()
        for r in source[80:]:r['magnitud']=9
        snapshot=engine.prepare(source,.8,CUTOFF)
        for algorithm in ['lineal_simple','lineal_multiple']:
            result=engine.train(snapshot,algorithm,42);artifact=json.loads(json.dumps(result['artefacto']))
            self.assertAlmostEqual(artifact['media'][0],sum(r['magnitud'] for r in source[:80])/80)
            self.assertNotIn('profundidad',artifact['features'])
            for r,pred in zip(source[80:],result['metricas']['muestra']):
                answer=engine.infer(artifact,r)
                self.assertAlmostEqual(answer['valor'],pred['estimado'],places=8)
                self.assertIn('magnitud',answer['fuera_rango'])
            self.assertEqual(result['metricas']['n_evaluacion'],20)
            self.assertIn('mae',result['baseline'])

    def test_classification_binary_and_multiclass_inference_and_metrics(self):
        for binary in [False,True]:
            source=rows()
            if binary:
                for r in source:r['profundidad']=r['profundidad']%250
            result=engine.train(engine.prepare(source,.8,CUTOFF),'logistica',42)
            self.assertEqual(sum(map(sum,result['metricas']['matriz'])),20)
            self.assertEqual(sum(b['n'] for b in result['metricas']['calibracion']),20)
            for r,pred in zip(source[80:],result['metricas']['muestra']):
                answer=engine.infer(result['artefacto'],r)
                self.assertAlmostEqual(sum(p['valor'] for p in answer['probabilidades']),1)
                self.assertEqual(answer['categoria'],engine.CLASSES[int(pred['estimado'])])
            again=engine.train(engine.prepare(source,.8,CUTOFF),'logistica',42)
            self.assertEqual(again['metricas'],result['metricas'])

    def test_degenerate_targets_and_invalid_order(self):
        source=rows()
        for r in source[80:]:r['profundidad']=80
        self.assertIsNone(engine.train(engine.prepare(source,.8,CUTOFF),'lineal_simple',42)['metricas']['r2'])
        for r in source:r['profundidad']=20
        with self.assertRaises(engine.DataError):engine.train(engine.prepare(source,.8,CUTOFF),'logistica',42)
        snapshot=engine.prepare(rows(),.8,CUTOFF);snapshot['filas'][0],snapshot['filas'][1]=snapshot['filas'][1],snapshot['filas'][0]
        with self.assertRaises(engine.DataError):engine.train(snapshot,'lineal_simple',42)


class StorageTests(unittest.IsolatedAsyncioTestCase):
    async def test_private_round_trip_hash_and_size(self):
        value={'español':'sí','filas':[1,2]};content=storage.encode(value)
        def respond(request):
            self.assertIn('/sismocore-privado/datasets/',str(request.url))
            if request.method=='POST':
                self.assertEqual(request.headers['x-upsert'],'false');return httpx.Response(200,json={})
            return httpx.Response(200,content=content)
        client=httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch.object(storage.httpx,'AsyncClient',return_value=client):
            result=await storage.download('datasets/'+ID+'.json',storage.digest(content))
            self.assertEqual(result,value)
        client=httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch.object(storage.httpx,'AsyncClient',return_value=client):
            with self.assertRaises(storage.ArtifactError):await storage.download('datasets/'+ID+'.json','wrong')
        client=httpx.AsyncClient(transport=httpx.MockTransport(respond))
        with patch.object(storage.httpx,'AsyncClient',return_value=client):
            self.assertEqual(await storage.upload('datasets/'+ID+'.json',value),storage.digest(content))
        with patch.object(storage,'MAX_BYTES',1):
            with self.assertRaises(storage.ArtifactError):await storage.upload('datasets/'+ID+'.json',value)
        for path in ['../secret','modelos/../../a.json',None,'datasets/'+'-'*36+'.json']:
            with self.assertRaises(storage.ArtifactError):storage.url(path)
        with self.assertRaises(ValueError):storage.encode({'bad':float('nan')})


class ModelApiTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        attempts.clear();self.actor={'id':ACTOR,'rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user]=lambda:dict(self.actor)
        self.snapshot=engine.prepare(rows(),.8,CUTOFF)
        self.snapshot['id']=ID
        self.dataset={'id':ID,'estado':'publicado','snapshot_path':'datasets/'+ID+'.json','snapshot_sha256':'a'*64,'numero_filas':100,'particion_temporal':self.snapshot['particion']}
        self.model={'id':ID,'estado':'aprobado','dataset_id':ID,'artefacto_path':'modelos/'+ID+'.json','artefacto_sha256':'b'*64,'version':1,'validacion':{'dataset_sha256':'a'*64}}
        self.calls=[]
        async def db(method,table,**kwargs):
            self.calls.append((table,kwargs))
            if table=='datasets':return [copy.deepcopy(self.dataset)]
            if table=='modelos_ml':return [copy.deepcopy(self.model)]
            if table=='eventos_sismicos':return rows()
            if table=='rpc/sismocore_registrar_auditoria':return ID
            if table.startswith('rpc/'):return {'id':ID,'estado':kwargs.get('data',{}).get('p_resultado',{}).get('estado','borrador')}
            return []
        self.db=patch('app.services.database.database.request',new=AsyncMock(side_effect=db));self.db.start()
        self.page=patch('app.services.database.database.page',new=AsyncMock(return_value=([],0)));self.page.start()
        self.client=httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173',headers={'Origin':'http://localhost:5173'})

    async def asyncTearDown(self):
        await self.client.aclose();self.db.stop();self.page.stop();app.dependency_overrides.clear();attempts.clear()

    async def test_role_and_validation_boundaries(self):
        body={'nombre':'Prueba','desde':'2026-01-01','hasta':'2026-01-05','confirmado':True}
        for role in ['lectura','operador','auditor']:
            self.actor['rol']=role
            self.assertEqual((await self.client.post('/api/v1/modelos/datasets',json=body)).status_code,403)
            self.assertEqual((await self.client.get('/api/v1/modelos')).status_code,200 if role=='auditor' else 403)
        self.actor['rol']='analista'
        self.assertEqual((await self.client.post(f'/api/v1/modelos/{ID}/aprobar',json={'confirmado':True})).status_code,403)
        self.assertEqual((await self.client.post('/api/v1/modelos/experimentos',json={'nombre':'Prueba','dataset_id':ID,'algoritmo':'arbitrary','confirmado':True})).status_code,422)
        self.assertEqual((await self.client.post('/api/v1/modelos/datasets',json={**body,'hasta':'2025-01-01'})).status_code,422)
        self.assertEqual((await self.client.post('/api/v1/modelos/datasets',json={**body,'confirmado':False})).status_code,422)

    async def test_igp_only_dataset_and_public_dto(self):
        with patch.object(storage,'upload',new=AsyncMock(return_value='a'*64)):
            response=await self.client.post('/api/v1/modelos/datasets',json={'nombre':'Prueba','desde':'2026-01-01','hasta':'2026-01-05','confirmado':True})
        self.assertEqual(response.status_code,201,response.text)
        event_query=next(kw['params'] for table,kw in self.calls if table=='eventos_sismicos')
        self.assertEqual(event_query['fuente.codigo'],'eq.igp')
        self.assertIn('recibido_en',event_query)
        self.assertNotIn('snapshot_path',response.text)

    async def test_training_failure_is_recorded_and_never_approved(self):
        with patch.object(storage,'download',new=AsyncMock(return_value=self.snapshot)),patch.object(engine,'train',side_effect=engine.DataError('Sin variedad')):
            response=await self.client.post('/api/v1/modelos/experimentos',json={'nombre':'Prueba','dataset_id':ID,'algoritmo':'logistica','confirmado':True})
        self.assertEqual(response.status_code,422,response.text)
        self.assertTrue(any(t.endswith('finalizar_modelo_ml') and kw['data']['p_resultado']['estado']=='fallido' for t,kw in self.calls))

    async def test_estimate_needs_approval_and_matching_artifact(self):
        self.model['estado']='evaluado'
        response=await self.client.post(f'/api/v1/modelos/{ID}/estimar',json={'magnitud':4,'latitud':-12,'longitud':-77})
        self.assertEqual(response.status_code,409)
        self.model['estado']='aprobado'
        with patch.object(storage,'download',new=AsyncMock(return_value={'id':ACTOR,'dataset_id':ID})):
            response=await self.client.post(f'/api/v1/modelos/{ID}/estimar',json={'magnitud':4,'latitud':-12,'longitud':-77})
        self.assertEqual(response.status_code,503)
        self.assertFalse(any('alerta' in t or 'voz' in t or 'sms' in t for t,_ in self.calls))

    async def test_storage_failure_blocks_publication(self):
        with patch.object(storage,'download',new=AsyncMock(side_effect=storage.ArtifactError('Huella inválida'))):
            response=await self.client.post(f'/api/v1/modelos/datasets/{ID}/publicar',json={'confirmado':True})
        self.assertEqual(response.status_code,503)
        self.assertFalse(any(t.endswith('publicar_dataset_ml') for t,_ in self.calls))


if __name__=='__main__':unittest.main()
