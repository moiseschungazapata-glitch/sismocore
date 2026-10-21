from fastapi import APIRouter
from app.core.config import settings
from app.services.database import database, DatabaseError
from app.services.ingestion import ingestion

router = APIRouter(tags=['Estado del sistema'])


@router.get('/health')
async def verificar_estado():
    connected = False
    if settings.database_configured:
        try:
            await database.request('GET', 'fuentes_datos', params={'select':'id','limit':'1'})
            connected = True
        except DatabaseError:
            pass
    return {
        'estado': 'saludable' if connected else 'degradado', 'servicio': 'api',
        'base_datos': 'conectada' if connected else 'desconectada',
        'configurada': settings.database_configured,
        'sincronizacion': ingestion.state,
        'mensaje': 'API y Supabase disponibles.' if connected else
            'API disponible; falta configurar o recuperar la conexion a Supabase.',
    }
