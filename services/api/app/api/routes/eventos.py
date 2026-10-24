from fastapi import APIRouter, Depends
from app.services.catalog import catalog
from app.services.permissions import require_permission, permissions_for

router = APIRouter(prefix='/eventos', tags=['Eventos sismicos'])


@router.get('', include_in_schema=False)
@router.get('/')
async def listar_eventos(user=Depends(require_permission('catalogo.leer'))):
    # Reads persistent observations. Only the internal worker contacts IGP.
    data = dict(await catalog.read())
    if 'fuentes.leer' not in permissions_for(user['rol']) and 'ultima_ejecucion' in data:
        data['ultima_ejecucion'] = None
    return data
