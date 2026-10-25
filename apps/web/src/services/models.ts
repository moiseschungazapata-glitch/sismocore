import { protectedRequest } from './auth'
export type Partition={entrenamiento:number;evaluacion:number;inicio_entrenamiento:string;fin_entrenamiento:string;inicio_evaluacion:string;fin_evaluacion:string;metodo:string;dataset_sha256?:string}
export type Dataset={id:string;nombre:string;version:number;estado:string;numero_filas:number;snapshot_sha256:string;creado_en:string;periodo_inicio:string;periodo_fin:string;informe_calidad:{recibidos:number;validos:number;descartados:number;duplicados:number;nulos:Record<string,number>};particion_temporal:Partition}
export type Prediction={id_externo:string;fecha:string;real:number;estimado:number}
export type Scores={mae?:number;rmse?:number;r2?:number|null;precision?:number;recall?:number;f1?:number;brier?:number;matriz?:number[][];clases?:string[];calibracion?:{desde:number;hasta:number;n:number;confianza:number;acierto:number}[];n_evaluacion?:number;muestra?:Prediction[];aviso_probabilidades?:string}
export type Model={id:string;nombre:string;version:number;dataset_id:string;objetivo:string;tarea:string;algoritmo:string;features:string[];target:string;semilla:number;hiperparametros:Record<string,unknown>;versiones_librerias:Record<string,string>;validacion:Partition;metricas:Scores;baseline:Scores;estado:string;limitaciones:string;error_resumen:string|null;creado_en:string;entrenamiento_inicio:string|null;entrenamiento_fin:string|null;aprobado_en:string|null;artefacto_sha256:string|null}
export type DatasetInput={nombre:string;desde:string;hasta:string;region:string|null;fraccion:number;confirmado:true}
export type TrainInput={nombre:string;dataset_id:string;algoritmo:string;semilla:number;confirmado:true}
export type Page={modelos:Model[];datasets:Dataset[];total:number;pagina:number;disponible:boolean;advertencia:string}
export type Estimate={valor?:number;unidad?:string;limite_inferior?:number;limite_superior?:number;categoria?:string;probabilidades?:{clase:string;valor:number}[];fuera_rango:string[];fuera_limite_fisico?:boolean;advertencia:string}
export const loadModels=(page:number,dataset:string,compare:boolean,signal?:AbortSignal)=>protectedRequest<Page>(`modelos?pagina=${page}&tamano=${compare?100:20}${dataset?'&dataset_id='+encodeURIComponent(dataset):''}`,undefined,undefined,signal)
export const prepareDataset=(body:DatasetInput)=>protectedRequest<{dataset:Dataset}>('modelos/datasets',body,undefined,undefined,120000)
export const inspectDataset=(id:string,signal?:AbortSignal)=>protectedRequest<{dataset:Dataset;vista_previa:Record<string,string|number|null>[];transformaciones:string[]}>(`modelos/datasets/${id}`,undefined,undefined,signal)
export const publishDataset=(id:string)=>protectedRequest(`modelos/datasets/${id}/publicar`,{confirmado:true})
export const trainModel=(body:TrainInput)=>protectedRequest<{modelo:Model}>('modelos/experimentos',body,undefined,undefined,160000)
export const loadModel=(id:string)=>protectedRequest<{modelo:Model}>(`modelos/${id}`)
export const approveModel=(id:string)=>protectedRequest(`modelos/${id}/aprobar`,{confirmado:true})
export const estimateModel=(id:string,variables:{magnitud:number;latitud:number;longitud:number})=>protectedRequest<{resultado:Estimate}>(`modelos/${id}/estimar`,variables)
