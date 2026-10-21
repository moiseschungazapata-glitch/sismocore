
from fastapi import APIRouter

router = APIRouter(tags=["Estado del sistema"])


@router.get("/health")
def verificar_estado():
    return {
        "estado": "saludable",
        "servicio": "api",
        "mensaje": "El backend está funcionando correctamente",
    }
