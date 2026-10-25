from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from app.services.catalog_filters import CatalogFilters as ExportFilters

from app.api.routes.auth import guard
from app.services import audit
from app.services.catalog import catalog
from app.services.permissions import require_permission

router = APIRouter(prefix='/reportes', tags=['Exportaciones autorizadas'])


@router.post('/exportar')
async def export_events(body: ExportFilters, request: Request, user=Depends(require_permission('reportes.exportar'))):
    guard(request, 'export')
    data = await catalog.read()
    text = body.q.strip().lower()
    events = [event for event in data['eventos'] if body.matches(event)]
    export_id = str(uuid4())
    await audit.record(request, 'reporte.exportar', 'reportes', actor=user, target=export_id,
        details={'filas':len(events),'formato':'xlsx','busqueda_aplicada':bool(text),
                 'magnitud':body.magnitud,'desde':body.desde.isoformat() if body.desde else None,
                 'hasta':body.hasta.isoformat() if body.hasta else None,
                 'fecha_corte':data['consultado_en']})
    return {'eventos':events, 'total':len(events), 'consultado_en':data['consultado_en'],
            'ultima_sincronizacion':data['ultima_sincronizacion'],'periodo_dias':data['periodo_dias'],
            'solicitante':{'id':user['id'],'nombre':user['nombre_completo'] or user['email']},
            'exportacion_id':export_id,'correlacion_id':request.state.correlation_id}
