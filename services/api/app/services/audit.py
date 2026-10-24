from uuid import uuid4

from app.services.database import database


async def record(request, action, entity, *, actor=None, target=None, result='correcto', details=None):
    correlation = getattr(request.state, 'correlation_id', str(uuid4()))
    return await database.request('POST', 'rpc/sismocore_registrar_auditoria', data={
        'p_actor_id': actor['id'] if actor else None,
        'p_accion': action, 'p_entidad': entity, 'p_entidad_id': str(target) if target else None,
        'p_resultado': result, 'p_detalles': details or {}, 'p_correlacion_id': correlation,
    })
