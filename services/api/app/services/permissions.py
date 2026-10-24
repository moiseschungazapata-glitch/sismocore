from fastapi import Depends, HTTPException, Request

from app.services.auth import require_user
from app.services import audit

ROLE_PERMISSIONS = {
    'administrador': ['catalogo.leer','fuentes.leer','reportes.exportar','usuarios.administrar','auditoria.leer','modelos.leer','alertas.leer'],
    'analista': ['catalogo.leer','fuentes.leer','reportes.exportar','modelos.leer'],
    'operador': ['catalogo.leer','alertas.leer'],
    'auditor': ['catalogo.leer','fuentes.leer','reportes.exportar','auditoria.leer','modelos.leer','alertas.leer'],
    'lectura': ['catalogo.leer'],
}


def permissions_for(role):
    return ROLE_PERMISSIONS.get(role, [])[:]


def require_permission(permission):
    async def allowed(request: Request, user=Depends(require_user)):
        if permission not in permissions_for(user['rol']):
            await audit.record(request, 'acceso.denegado', 'permisos', actor=user,
                result='denegado', details={'permiso': permission, 'rol': user['rol']})
            raise HTTPException(403, 'Tu rol no tiene permiso para realizar esta operación.',
                                headers={'X-Permission-Denied': 'true'})
        return user
    return allowed
