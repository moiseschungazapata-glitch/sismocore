
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.eventos import router as eventos_router
from app.core.config import settings


app = FastAPI(
    title=settings.APP_NAME,
    description="API para el monitoreo y análisis de eventos sísmicos.",
    version=settings.APP_VERSION,
    debug=settings.DEBUG,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(
    eventos_router,
    prefix=settings.API_PREFIX,
)


@app.get("/")
def inicio():
    return {
        "mensaje": settings.APP_NAME,
        "estado": "operativo",
        "version": settings.APP_VERSION,
    }
