from datetime import date
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.routes.auth import guard
from app.services import audit
from app.services.catalog import catalog
from app.services.permissions import require_permission

router = APIRouter(prefix='/reportes', tags=['Exportaciones autorizadas'])


class ExportFilters(BaseModel):
    model_config = ConfigDict(extra='forbid')
    q: str = Field('', max_length=200)
    magnitud: Literal['todos','menor','medio','mayor'] = 'todos'
    desde: date | None = None
    hasta: date | None = None

    @model_validator(mode='after')
    def valid_range(self):
        if self.desde and self.hasta and self.desde > self.hasta:
            raise ValueError('Rango de fechas inválido')
        return self


@router.post('/exportar')
async def export_events(body: ExportFilters, request: Request, user=Depends(require_permission('reportes.exportar'))):
    guard(request, 'export')
    data = await catalog.read()
    text = body.q.strip().lower()
    def matches(event):
        if text not in f'{event["lugar"]} {event["id_externo"]} {event["id"]}'.lower(): return False
        if body.desde and event['ocurrido_en'][:10] < body.desde.isoformat(): return False
        if body.hasta and event['ocurrido_en'][:10] > body.hasta.isoformat(): return False
        magnitude = event['magnitud']
        return body.magnitud == 'todos' or magnitude is not None and (
            magnitude < 4 if body.magnitud == 'menor' else 4 <= magnitude < 6 if body.magnitud == 'medio' else magnitude >= 6)
    events = [event for event in data['eventos'] if matches(event)]
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
