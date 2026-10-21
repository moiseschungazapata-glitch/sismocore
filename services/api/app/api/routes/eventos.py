from fastapi import APIRouter
from app.services.catalog import catalog

router = APIRouter(prefix='/eventos', tags=['Eventos sismicos'])


@router.get('/')
async def listar_eventos():
    # Reads persistent observations. Only the internal worker contacts USGS.
    return await catalog.read()
