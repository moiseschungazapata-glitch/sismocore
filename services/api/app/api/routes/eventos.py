import json
from uuid import UUID
from fastapi import APIRouter, Depends, Request, HTTPException
from pydantic import ValidationError
from app.services.catalog_filters import CatalogFilters
from app.services.catalog import catalog
from app.services.permissions import require_permission, permissions_for

router = APIRouter(prefix='/eventos', tags=['Eventos sismicos'])


@router.get('', include_in_schema=False)
@router.get('/')
async def listar_eventos(request:Request,user=Depends(require_permission('catalogo.leer'))):
    # Reads persistent observations. Only the internal worker contacts IGP.
    data = dict(await catalog.read())
    params=dict(request.query_params)
    try:
        pagina=int(params.pop('pagina', '0'))
        tamano=int(params.pop('tamano', '20'))
        orden=params.pop('orden', 'fecha_desc')
        if pagina<0 or not 1<=tamano<=100 or orden not in ('fecha_desc','fecha_asc','magnitud_desc','magnitud_asc','profundidad_desc','profundidad_asc'):
            raise ValueError()
        if 'poligono' in params:
            if len(params['poligono'])>3000: raise ValueError()
            params['poligono']=json.loads(params['poligono'])
        filters=CatalogFilters.model_validate(params)
    except (ValueError,ValidationError):
        raise HTTPException(422,'Revisa los filtros y la paginación.') from None
    events=[e for e in data['eventos'] if filters.matches(e)]
    field,direction=orden.split('_')
    field={'fecha':'ocurrido_en','magnitud':'magnitud','profundidad':'profundidad'}[field]
    known=[e for e in events if e[field] is not None]
    known.sort(key=lambda e:(e[field],e['id']),reverse=direction=='desc')
    events=known+[e for e in events if e[field] is None]
    data['total']=len(events)
    data['eventos']=events[(pagina-1)*tamano:pagina*tamano] if pagina else events
    if pagina: data.update(pagina=pagina,tamano=tamano)
    if 'fuentes.leer' not in permissions_for(user['rol']) and 'ultima_ejecucion' in data:
        data['ultima_ejecucion'] = None
    return data


@router.get('/{event_id}')
async def detalle_evento(event_id:UUID,user=Depends(require_permission('catalogo.leer'))):
    data=await catalog.read()
    event=next((e for e in data['eventos'] if e['id']==str(event_id)),None)
    if event is None: raise HTTPException(404,'Evento no disponible en el periodo del catálogo.')
    return {'evento':event,'fuente':data['fuente'],'consultado_en':data['consultado_en']}
