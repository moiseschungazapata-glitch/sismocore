"""Retrospective supervised experiments; no prediction of future earthquakes."""
import math
import platform
from datetime import datetime,timezone
from importlib.metadata import version

ALGORITHMS={'lineal_simple':['magnitud'],'lineal_multiple':['magnitud','latitud','longitud'],'logistica':['magnitud','latitud','longitud']}
CLASSES=['Superficial (<70 km)','Intermedio (70 a <300 km)','Profundo (≥300 km)']
DISCLAIMER='Resultado experimental sobre eventos observados. No predice terremotos ni representa una alerta oficial.'


class DataError(Exception):
    pass


def prepare(rows,fraction,cutoff):
    if fraction not in (0.7,0.8):raise DataError('Partición no admitida.')
    clean=[];seen=set();duplicates=0;invalid=0
    fields=['magnitud','profundidad','latitud','longitud','ocurrido_en']
    missing={key:sum(row.get(key) is None for row in rows) for key in fields}
    for row in rows:
        identity=row.get('id_externo')
        if identity in seen:duplicates+=1;continue
        seen.add(identity)
        try:
            timestamp=datetime.fromisoformat(row['ocurrido_en'].replace('Z','+00:00'))
            if timestamp.tzinfo is None or timestamp>datetime.fromisoformat(cutoff):raise ValueError()
            for key,low,high in [('magnitud',0,10),('profundidad',0,1000),('latitud',-90,90),('longitud',-180,180)]:
                v=row[key]
                if isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) or not low<=v<=high:raise ValueError()
            clean.append({k:row.get(k) for k in ['id','id_externo','magnitud','profundidad','latitud','longitud','region','hash_origen']}|{'ocurrido_en':timestamp.astimezone(timezone.utc).isoformat()})
        except (KeyError,ValueError,TypeError):invalid+=1
    clean.sort(key=lambda r:(r['ocurrido_en'],r['id']))
    if not 50<=len(clean)<=5000:raise DataError(f'Se requieren entre 50 y 5000 registros completos; quedaron {len(clean)}.')
    split=int(len(clean)*fraction)
    while split<len(clean) and clean[split]['ocurrido_en']==clean[split-1]['ocurrido_en']:split+=1
    if split<30 or len(clean)-split<10:raise DataError('La partición temporal necesita al menos 30 registros de entrenamiento y 10 de evaluación, sin fechas compartidas.')
    quality={'recibidos':len(rows),'validos':len(clean),'descartados':invalid,'duplicados':duplicates,'nulos':missing,'pipeline_version':1}
    partition={'metodo':'holdout_temporal','fraccion_solicitada':fraction,'entrenamiento':split,'evaluacion':len(clean)-split,
        'inicio_entrenamiento':clean[0]['ocurrido_en'],'fin_entrenamiento':clean[split-1]['ocurrido_en'],
        'inicio_evaluacion':clean[split]['ocurrido_en'],'fin_evaluacion':clean[-1]['ocurrido_en'],'mezcla_aleatoria':False}
    return {'formato':'sismocore-dataset-v1','fuente':'igp','corte':cutoff,'filas':clean,'calidad':quality,'particion':partition}


def train(snapshot,algorithm,seed):
    # Heavy imports only when a user trains: cron and notification cold starts stay light.
    import numpy as np
    import pandas as pd
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.linear_model import LinearRegression,LogisticRegression
    from sklearn.dummy import DummyRegressor,DummyClassifier
    from sklearn.metrics import mean_absolute_error,root_mean_squared_error,r2_score,precision_recall_fscore_support,confusion_matrix
    from threadpoolctl import threadpool_limits
    if snapshot.get('formato')!='sismocore-dataset-v1' or algorithm not in ALGORITHMS:raise DataError('Formato de experimento no admitido.')
    rows=snapshot['filas'];split=snapshot['particion']['entrenamiento']
    if not 50<=len(rows)<=5000 or not 30<=split<=len(rows)-10 or rows[split-1]['ocurrido_en']>=rows[split]['ocurrido_en'] or any(a['ocurrido_en']>b['ocurrido_en'] for a,b in zip(rows,rows[1:])):raise DataError('Partición temporal inválida.')
    features=ALGORITHMS[algorithm];df=pd.DataFrame(rows)
    X=df[features].to_numpy(dtype=float);depth=df.profundidad.to_numpy(dtype=float)
    if not np.isfinite(X).all() or not np.isfinite(depth).all():raise DataError('El dataset contiene valores no finitos.')
    classification=algorithm=='logistica'
    y=np.where(depth<70,0,np.where(depth<300,1,2)) if classification else depth
    if classification and len(np.unique(y[:split]))<2:raise DataError('La clasificación necesita al menos dos rangos de profundidad en el entrenamiento. Amplía el periodo del dataset.')
    estimator=LogisticRegression(C=1,max_iter=1000,solver='lbfgs',random_state=seed) if classification else LinearRegression()
    pipe=make_pipeline(StandardScaler(),estimator)
    dummy=DummyClassifier(strategy='prior',random_state=seed) if classification else DummyRegressor(strategy='mean')
    with threadpool_limits(limits=1):
        pipe.fit(X[:split],y[:split]);dummy.fit(X[:split],y[:split])
        predicted=pipe.predict(X[split:]);baseline=dummy.predict(X[split:])
    actual=y[split:];metrics={};reference={}
    if classification:
        def scores(pred):
            p,r,f,_=precision_recall_fscore_support(actual,pred,labels=[0,1,2],average='macro',zero_division=0)
            return {'precision':float(p),'recall':float(r),'f1':float(f),'matriz':confusion_matrix(actual,pred,labels=[0,1,2]).tolist(),'clases':CLASSES,'promedio':'macro sobre los tres rangos'}
        metrics=scores(predicted);reference=scores(baseline)
        def full_probs(model):
            probabilities=np.zeros((len(actual),3));probabilities[:,model.classes_.astype(int)]=model.predict_proba(X[split:]);return probabilities
        probs=full_probs(pipe);base_probs=full_probs(dummy);truth=np.eye(3)[actual]
        metrics['brier']=float(np.mean(np.sum((probs-truth)**2,axis=1)));reference['brier']=float(np.mean(np.sum((base_probs-truth)**2,axis=1)))
        confidence=probs.max(axis=1);correct=(predicted==actual)
        metrics['calibracion']=[{'desde':i/5,'hasta':(i+1)/5,'n':int(mask.sum()),'confianza':float(confidence[mask].mean()),'acierto':float(correct[mask].mean())} for i in range(5) if (mask:=((confidence>=i/5)&(confidence<(i+1)/5 if i<4 else confidence<=1))).any()]
        metrics['aviso_probabilidades']='Probabilidades sin calibración validada. Brier y la tabla de confianza evalúan este conjunto; no son riesgo sísmico.'
    else:
        def scores(pred):return {'mae':float(mean_absolute_error(actual,pred)),'rmse':float(root_mean_squared_error(actual,pred)),'r2':float(r2_score(actual,pred)) if np.var(actual)>0 else None}
        metrics=scores(predicted);reference=scores(baseline)
    metrics['n_evaluacion']=len(actual)
    metrics['muestra']=[{'id_externo':row['id_externo'],'fecha':row['ocurrido_en'],'real':float(value),'estimado':float(pred)} for row,value,pred in zip(rows[split:split+100],actual[:100],predicted[:100])]
    scaler=pipe.steps[0][1];fitted=pipe.steps[1][1]
    libraries={name:version(name) for name in ['numpy','pandas','scikit-learn','joblib','scipy','threadpoolctl']};libraries['python']=platform.python_version()
    artifact={'formato':'sismocore-model-v1','algoritmo':algorithm,'features':features,'media':scaler.mean_.tolist(),'escala':scaler.scale_.tolist(),
        'coef':fitted.coef_.tolist(),'intercepto':fitted.intercept_.tolist() if hasattr(fitted.intercept_,'tolist') else float(fitted.intercept_),
        'clases':fitted.classes_.astype(int).tolist() if classification else None,
        'rango_features':{key:[float(X[:split,j].min()),float(X[:split,j].max())] for j,key in enumerate(features)},
        'sigma_residuos':None if classification else float(np.std(y[:split]-pipe.predict(X[:split]),ddof=1)),
        'versiones':libraries,'semilla':seed,'particion':snapshot['particion'],'advertencia':DISCLAIMER}
    return {'metricas':metrics,'baseline':reference,'versiones_librerias':libraries,'artefacto':artifact}


def infer(artifact,values):
    import numpy as np
    if artifact.get('formato')!='sismocore-model-v1':raise DataError('Artefacto no compatible.')
    features=artifact['features']
    X=np.array([values[f] for f in features],dtype=float)
    if not np.isfinite(X).all():raise DataError('Variables no válidas.')
    outside=[f for f,v in zip(features,X) if not artifact['rango_features'][f][0]<=v<=artifact['rango_features'][f][1]]
    Z=(X-np.array(artifact['media']))/np.array(artifact['escala'])
    raw=np.asarray(artifact['coef'])@Z+np.asarray(artifact['intercepto'])
    if artifact['algoritmo']=='logistica':
        classes=artifact['clases']
        if len(classes)==2:
            p=1/(1+np.exp(-np.clip(float(raw[0]),-700,700)));probabilities=[1-p,p]
        else:
            shifted=raw-raw.max();exp=np.exp(shifted);probabilities=(exp/exp.sum()).tolist()
        index=int(np.argmax(probabilities))
        return {'categoria':CLASSES[classes[index]],'probabilidades':[{'clase':CLASSES[c],'valor':float(p)} for c,p in zip(classes,probabilities)],'fuera_rango':outside,'advertencia':DISCLAIMER+' Probabilidades sin calibración validada.'}
    value=float(raw);width=1.96*artifact['sigma_residuos']
    return {'valor':value,'unidad':'km','limite_inferior':value-width,'limite_superior':value+width,'fuera_rango':outside,'fuera_limite_fisico':not 0<=value<=1000,
        'advertencia':DISCLAIMER+' La banda refleja residuos de entrenamiento; su cobertura no está validada.'}
