import copy
import sys
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from main import app
from app.services.auth import auth, require_user
from app.services.permissions import ROLE_PERMISSIONS
from app.services.database import DatabaseError

ID = '11111111-1111-4111-8111-111111111111'
TARGET = '22222222-2222-4222-8222-222222222222'
STAMP = '2026-10-23T12:00:00+00:00'
ORIGIN = {'Origin':'http://localhost:5173'}
PROFILE = {'id':TARGET,'nombre_completo':'Cuenta de prueba','rol':'lectura','estado':'activo','creado_en':STAMP,'actualizado_en':STAMP}
EVENT = {'id':TARGET,'id_externo':'2026-1','lugar':'Camaná, Perú','ocurrido_en':'2026-10-23T10:00:00+00:00','magnitud':4.2,'profundidad':20,'latitud':-12,'longitud':-77,'tipo_magnitud':None,'url_fuente':'https://example.org','estado_revision':'reportado_igp'}
CATALOG = {'eventos':[EVENT],'total':1,'consultado_en':STAMP,'ultima_sincronizacion':STAMP,'periodo_dias':30,
    'fuente':'IGP/CENSIS','codigo_fuente':'igp','url_fuente':'https://example.org','frecuencia_segundos':600,
    'ultima_ejecucion':{'error_resumen':'Información operativa'},'sincronizacion':'actualizada'}


class PermissionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.actor = {'id':ID,'nombre_completo':'Responsable','email':'actor@example.org','rol':'administrador','estado':'activo'}
        app.dependency_overrides[require_user] = lambda: dict(self.actor)
        self.records = []
        self.rpc_error = None
        async def request(method, table, **kw):
            if table == 'rpc/sismocore_registrar_auditoria':
                self.records.append(kw['data']); return TARGET
            if table == 'rpc/sismocore_actualizar_perfil':
                if self.rpc_error: raise self.rpc_error
                self.records.append(kw['data'])
                return {**PROFILE,'nombre_completo':kw['data']['p_nombre'],'rol':kw['data']['p_rol'],'estado':kw['data']['p_estado']}
            return [copy.deepcopy(PROFILE)]
        self.db = patch('app.services.database.database.request', new=AsyncMock(side_effect=request))
        self.db.start()
        self.pager = patch('app.services.database.database.page', new=AsyncMock(return_value=([copy.deepcopy(PROFILE)],1)))
        self.page = self.pager.start()
        self.catalog_patch = patch('app.services.catalog.catalog.read', new=AsyncMock(return_value=copy.deepcopy(CATALOG)))
        self.catalog_patch.start()
        async def admin(method, path, **kw):
            return httpx.Response(200, json={'id':TARGET,'email':'person@example.org','last_sign_in_at':STAMP,
                'encrypted_password':'NEVER_EXPOSE','factors':[{'status':'verified','secret':'NEVER_EXPOSE'}]})
        self.admin_patch = patch.object(auth,'admin_request',new=AsyncMock(side_effect=admin))
        self.admin = self.admin_patch.start()
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://localhost:5173')

    async def asyncTearDown(self):
        await self.client.aclose()
        for item in (self.db,self.pager,self.catalog_patch,self.admin_patch): item.stop()
        app.dependency_overrides.clear()
        from app.api.routes.auth import attempts
        attempts.clear()

    async def test_role_matrix_for_every_protected_read_endpoint(self):
        endpoints = [('/api/v1/usuarios','usuarios.administrar'),('/api/v1/usuarios/roles','usuarios.administrar'),
            ('/api/v1/auditoria','auditoria.leer'),('/api/v1/fuentes','fuentes.leer'),('/api/v1/eventos','catalogo.leer')]
        for role, permissions in ROLE_PERMISSIONS.items():
            self.actor['rol'] = role
            for path, permission in endpoints:
                with self.subTest(role=role,path=path):
                    response = await self.client.get(path)
                    self.assertEqual(response.status_code,200 if permission in permissions else 403)
                    self.assertEqual(response.headers['cache-control'],'no-store')
                    self.assertIn('x-correlation-id',response.headers)
                    self.assertNotIn('NEVER_EXPOSE',response.text)

    async def test_non_admins_cannot_create_or_modify_accounts(self):
        for role in ('analista','operador','auditor','lectura'):
            self.actor['rol'] = role
            result = await self.client.post('/api/v1/usuarios',headers=ORIGIN,json={
                'nombre_completo':'Nueva Cuenta','email':'new@example.org','password':'test-only-password','rol':'administrador','estado':'activo'})
            self.assertEqual(result.status_code,403)
            result = await self.client.patch(f'/api/v1/usuarios/{TARGET}',headers=ORIGIN,json={
                'nombre_completo':'Nueva Cuenta','rol':'administrador','estado':'activo','actualizado_en':STAMP})
            self.assertEqual(result.status_code,403)
        self.admin.assert_not_awaited()
        self.assertTrue(all(row['p_resultado']=='denegado' for row in self.records))

    async def test_admin_change_uses_verified_actor_and_version(self):
        result = await self.client.patch(f'/api/v1/usuarios/{TARGET}',headers=ORIGIN,json={
            'nombre_completo':'Analista','rol':'analista','estado':'activo','actualizado_en':STAMP})
        self.assertEqual(result.status_code,200)
        rpc = next(row for row in self.records if 'p_usuario_id' in row)
        self.assertEqual(rpc['p_actor_id'],ID)
        self.assertEqual(rpc['p_usuario_id'],TARGET)
        self.assertEqual(rpc['p_actualizado_en'],STAMP)
        self.assertEqual(rpc['p_correlacion_id'],result.headers['x-correlation-id'])

    async def test_concurrent_or_unsafe_change_becomes_safe_conflict(self):
        self.rpc_error = DatabaseError(409,'PT409')
        result = await self.client.patch(f'/api/v1/usuarios/{TARGET}',headers=ORIGIN,json={
            'nombre_completo':'Analista','rol':'analista','estado':'activo','actualizado_en':STAMP})
        self.assertEqual(result.status_code,409)
        self.assertEqual(self.records[-1]['p_resultado'],'denegado')

    async def test_admin_create_sends_password_only_to_supabase_auth(self):
        result = await self.client.post('/api/v1/usuarios',headers=ORIGIN,json={
            'nombre_completo':'Nueva Cuenta','email':'new@example.org','password':'test-only-password','rol':'analista','estado':'pendiente'})
        self.assertEqual(result.status_code,201)
        first = self.admin.await_args_list[0]
        self.assertEqual(first.args,('POST','admin/users'))
        self.assertEqual(first.kwargs['data']['password'],'test-only-password')
        self.assertNotIn('test-only-password',str(self.records))
        self.assertNotIn('test-only-password',result.text)
        self.assertNotIn('NEVER_EXPOSE',result.text)

    async def test_client_cannot_supply_actor_or_extra_sensitive_fields(self):
        result = await self.client.patch(f'/api/v1/usuarios/{TARGET}',headers=ORIGIN,json={
            'nombre_completo':'Analista','rol':'analista','estado':'activo','actualizado_en':STAMP,'actor_id':TARGET,'password':'PRIVATE_VALUE'})
        self.assertEqual(result.status_code,422)
        self.assertNotIn('PRIVATE_VALUE',result.text)
        self.assertFalse(self.records)

    async def test_mutations_reject_cross_origin_even_for_admin(self):
        result = await self.client.patch(f'/api/v1/usuarios/{TARGET}',headers={'Origin':'https://untrusted.example'},json={
            'nombre_completo':'Analista','rol':'analista','estado':'activo','actualizado_en':STAMP})
        self.assertEqual(result.status_code,403)
        self.assertFalse(self.records)

    async def test_exports_are_authorized_on_server_and_audit_actual_snapshot(self):
        for role, permissions in ROLE_PERMISSIONS.items():
            self.actor['rol'] = role
            result = await self.client.post('/api/v1/reportes/exportar',headers=ORIGIN,json={'q':'Camaná','magnitud':'medio','desde':'2026-10-20'})
            allowed = 'reportes.exportar' in permissions
            self.assertEqual(result.status_code,200 if allowed else 403)
            if allowed:
                self.assertEqual(result.json()['total'],1)
                self.assertEqual(result.json()['solicitante']['id'],ID)
                self.assertEqual(self.records[-1]['p_detalles']['filas'],1)
                self.assertNotIn('Camaná',str(self.records[-1]))

    async def test_invalid_export_filters_and_audit_dates_are_rejected(self):
        for body in ({'magnitud':'invalid'},{'desde':'not-date'},{'q':'x'*201}):
            self.assertEqual((await self.client.post('/api/v1/reportes/exportar',headers=ORIGIN,json=body)).status_code,422)
        self.assertEqual((await self.client.get('/api/v1/auditoria?desde=2026-10-24&hasta=2026-10-20')).status_code,422)

    async def test_reader_catalog_does_not_disclose_connector_execution_details(self):
        self.actor['rol'] = 'lectura'
        self.assertIsNone((await self.client.get('/api/v1/eventos')).json()['ultima_ejecucion'])

    async def test_audit_has_no_update_or_delete_api(self):
        for method in ('PATCH','DELETE'):
            self.assertEqual((await self.client.request(method,'/api/v1/auditoria',headers=ORIGIN)).status_code,405)

    async def test_pagination_is_bounded_and_filter_queries_are_built_on_server(self):
        self.assertEqual((await self.client.get('/api/v1/usuarios?tamano=1000')).status_code,422)
        result = await self.client.get('/api/v1/usuarios?rol=analista&estado=activo&pagina=2')
        self.assertEqual(result.status_code,200)
        params = self.page.await_args.kwargs['params']
        self.assertEqual(params['rol'],'eq.analista')
        self.assertEqual(params['offset'],'20')
