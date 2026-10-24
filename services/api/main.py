import asyncio
from contextlib import asynccontextmanager, suppress
from uuid import uuid4

from fastapi import Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes.health import router as health_router
from app.api.routes.eventos import router as eventos_router
from app.api.routes.auth import router as auth_router
from app.services.auth import auth, require_user
from app.core.config import settings
from app.services.database import database, DatabaseError
from app.services.ingestion import ingestion
from app.api.routes.admin import router as admin_router
from app.api.routes.reports import router as reports_router
from app.api.routes.sources import router as sources_router


@asynccontextmanager
async def lifespan(app):
    task = None
    if settings.database_configured:
        await database.open()
        await auth.open()
        if settings.RUN_BACKGROUND_SYNC:
            task = asyncio.create_task(ingestion.run())
    yield
    if task:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await database.close()
    await auth.close()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION,
              debug=settings.DEBUG, lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.CORS_ORIGINS,
                   allow_methods=['GET', 'POST', 'PATCH'], allow_headers=['Content-Type'],
                   expose_headers=['X-Correlation-ID','X-Permission-Denied'], allow_credentials=True)


@app.middleware('http')
async def private_responses(request, call_next):
    request.state.correlation_id = str(uuid4())
    response = await call_next(request)
    response.headers['X-Correlation-ID'] = request.state.correlation_id
    if request.url.path.startswith('/api/') or request.url.path == '/health':
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Content-Type-Options'] = 'nosniff'
    return response


@app.exception_handler(RequestValidationError)
async def invalid_input(request: Request, exc):
    # Default validation errors echo rejected input, including passwords and tokens.
    return JSONResponse(status_code=422, content={'detail': 'Revisa los campos del formulario y vuelve a intentarlo.'})


@app.exception_handler(DatabaseError)
async def database_unavailable(request, exc):
    return JSONResponse(status_code=503, content={'detail':
        'No se pudo consultar Supabase. Revisa la conexion privada del servidor.'})


app.include_router(auth_router, prefix=settings.API_PREFIX)
app.include_router(health_router, dependencies=[Depends(require_user)])
app.include_router(eventos_router, prefix=settings.API_PREFIX)
app.include_router(admin_router, prefix=settings.API_PREFIX)
app.include_router(reports_router, prefix=settings.API_PREFIX)
app.include_router(sources_router, prefix=settings.API_PREFIX)


@app.get('/')
async def inicio():
    return {'mensaje': settings.APP_NAME, 'version': settings.APP_VERSION}


@app.get('/live')
async def process_alive():
    # Process liveness is independent of a slow/offline external database.
    return {'servicio': 'api', 'estado': 'activo', 'version': settings.APP_VERSION}
