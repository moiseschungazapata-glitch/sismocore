from fastapi import APIRouter, Depends

from app.services.catalog import catalog
from app.services.permissions import require_permission

router = APIRouter(prefix='/fuentes', tags=['Estado de fuentes'])


@router.get('')
async def sources(user=Depends(require_permission('fuentes.leer'))):
    data = await catalog.read()
    return {key:data[key] for key in ('fuente','codigo_fuente','url_fuente','frecuencia_segundos',
        'ultima_sincronizacion','ultima_ejecucion','sincronizacion','periodo_dias','total')}
