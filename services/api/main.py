import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.health import router as health_router
from app.api.routes.eventos import router as eventos_router
from app.core.config import settings
from app.services.database import database, DatabaseError
from app.services.ingestion import ingestion


@asynccontextmanager
async def lifespan(app):
    task = None
    if settings.database_configured:
        await database.open()
        task = asyncio.create_task(ingestion.run())
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await database.close()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION,
              debug=settings.DEBUG, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS,
                   allow_methods=['GET'], allow_headers=['*'])


@app.exception_handler(DatabaseError)
async def database_unavailable(request, exc):
    return JSONResponse(status_code=503, content={'detail':
        'No se pudo consultar Supabase. Revisa la conexion privada del servidor.'})


app.include_router(health_router)
app.include_router(eventos_router, prefix=settings.API_PREFIX)


@app.get('/')
async def inicio():
    return {'mensaje': settings.APP_NAME, 'version': settings.APP_VERSION}
