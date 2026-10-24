// Browser checks use simulated identities; they never create or alter real accounts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser = await chromium.launch({ channel:'chrome', headless:true });
const origin = process.env.PHASE2_TEST_URL || 'http://localhost:5173';
const roles = {
  administrador:['catalogo.leer','fuentes.leer','reportes.exportar','usuarios.administrar','auditoria.leer','modelos.leer','alertas.leer'],
  analista:['catalogo.leer','fuentes.leer','reportes.exportar','modelos.leer'],
  operador:['catalogo.leer','alertas.leer'],
  auditor:['catalogo.leer','fuentes.leer','reportes.exportar','auditoria.leer','modelos.leer','alertas.leer'],
  lectura:['catalogo.leer'],
};
const now = new Date().toISOString();
const owner = { id:'00000000-0000-4000-8000-000000000001', nombre_completo:'Administración de prueba', email:'admin@example.org', rol:'administrador', estado:'activo', creado_en:now, actualizado_en:now, ultimo_acceso_en:now, mfa_activo:false };
const other = { ...owner, id:'00000000-0000-4000-8000-000000000002', nombre_completo:'Analista de prueba', email:'analista@example.org', rol:'analista' };
const auditEntry = { id:'00000000-0000-4000-8000-000000000003', actor_id:owner.id, actor_tipo:'usuario', actor:{ nombre_completo:owner.nombre_completo }, accion:'UPDATE', entidad:'perfiles', entidad_id:other.id, antes:{ rol:'lectura' }, despues:{ rol:'analista' }, resultado:'correcto', ocurrido_en:now, correlacion_id:'00000000-0000-4000-8000-000000000004' };
const errors = [], violations = [], requests = [];
let audits = 0;
async function axe(page, label) {
  if (!process.env.AXE_SCRIPT) return;
  await page.addScriptTag({ path:process.env.AXE_SCRIPT });
  const result = await page.evaluate(async () => (await window.axe.run(document, { runOnly:{ type:'tag', values:['wcag2a','wcag2aa','wcag21a','wcag21aa','best-practice'] } })).violations.map(v => ({ id:v.id, nodes:v.nodes.map(n => ({ target:n.target, message:n.failureSummary })) })));
  audits++;
  if (result.length) violations.push({ label, result });
}
async function setup(role) {
  const context = await browser.newContext({ viewport:{ width:1440, height:960 } });
  const page = await context.newPage();
  const user = { ...owner, rol:role, permisos:roles[role] };
  let accounts = [{ ...owner, permisos:roles.administrador }, { ...other, permisos:roles.analista }];
  let rejectEdit = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/health', route => route.fulfill({ json:{ estado:'saludable', base_datos:'conectada', configurada:true } }));
  await page.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    requests.push({ role, method:request.method(), path, query:url.search });
    if (path === '/api/v1/auth/me') return route.fulfill({ json:{ user } });
    if (path === '/api/v1/eventos') return route.fulfill({ json:{ eventos:[], total:0, codigo_fuente:'igp', fuente:'IGP', periodo_dias:30, frecuencia_segundos:600, consultado_en:now, ultima_sincronizacion:now, ultima_ejecucion:null } });
    if (path === '/api/v1/usuarios' && request.method() === 'GET') return route.fulfill({ json:{ usuarios:accounts, total:accounts.length, pagina:1, tamano:20 } });
    if (path === '/api/v1/usuarios' && request.method() === 'POST') {
      const body = request.postDataJSON();
      assert.equal(body.rol, 'lectura'); assert.equal(body.estado,'pendiente');
      assert.equal(body.password,'browser-test-only-1234');
      assert.ok(!('actor_id' in body));
      accounts.push({ ...other, ...body, id:'00000000-0000-4000-8000-000000000005', password:undefined, permisos:roles[body.rol] });
      return route.fulfill({ status:201, json:{ usuario:accounts.at(-1) } });
    }
    if (path.startsWith('/api/v1/usuarios/') && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      assert.equal(body.actualizado_en,now); assert.ok(!('password' in body)); assert.ok(!('actor_id' in body));
      if (rejectEdit) { rejectEdit = false; return route.fulfill({ status:409, json:{ detail:'La cuenta cambió. Actualiza la lista y vuelve a intentarlo.' } }); }
      accounts = accounts.map(account => path.endsWith(account.id) ? { ...account,...body } : account);
      return route.fulfill({ json:{ usuario:accounts.find(account => path.endsWith(account.id)) } });
    }
    if (path === '/api/v1/auditoria') return route.fulfill({ json:{ registros:[auditEntry], total:1, pagina:1, tamano:20, fecha_corte:now } });
    return route.fulfill({ status:404, json:{ detail:'Ruta de prueba no configurada.' } });
  });
  return { page, context, conflict:() => { rejectEdit = true; } };
}
try {
  await mkdir('.runtime/phase2', { recursive:true });
  for (const role of Object.keys(roles)) {
    const { page, context } = await setup(role);
    await page.goto(origin + '/usuarios');
    await page.getByRole('heading', { name:'Usuarios y roles', exact:true }).waitFor();
    if (role === 'administrador') await page.getByRole('button', { name:'Crear usuario', exact:true }).waitFor();
    else {
      await page.getByRole('heading', { name:'Tu rol no tiene acceso a este módulo' }).waitFor();
      assert.equal(await page.getByRole('button', { name:'Crear usuario', exact:true }).count(),0);
      assert.equal(await page.getByRole('link', { name:'Usuarios y roles', exact:true }).count(),0);
    }
    assert.equal(await page.getByRole('link', { name:'Reportes', exact:true }).count(), roles[role].includes('reportes.exportar') ? 1 : 0);
    assert.equal(await page.getByRole('link', { name:'Auditoría', exact:true }).count(), roles[role].includes('auditoria.leer') ? 1 : 0);
    if (role !== 'administrador') assert.ok(!requests.some(r => r.role === role && r.path === '/api/v1/usuarios'));
    await page.goto(origin + '/auditoria');
    await page.getByRole('heading', { name:roles[role].includes('auditoria.leer') ? 'Bitácora de operaciones' : 'Tu rol no tiene acceso a este módulo' }).waitFor();
    await context.close();
  }
  const { page, context, conflict } = await setup('administrador');
  await page.goto(origin + '/usuarios');
  await page.getByRole('button', { name:'Editar admin@example.org', exact:true }).filter({ visible:true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.getByLabel('Rol de la cuenta').isDisabled(),true);
  assert.equal(await dialog.getByLabel('Estado de la cuenta').isDisabled(),true);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name:'Crear usuario', exact:true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nombre completo', { exact:true }).fill('Cuenta de prueba');
  await dialog.getByLabel('Correo electrónico', { exact:true }).fill('nueva@example.org');
  await dialog.getByLabel('Contraseña inicial', { exact:true }).fill('browser-test-only-1234');
  assert.equal(await dialog.getByLabel('Rol de la cuenta').inputValue(),'lectura');
  for (let i = 0; i < 12; i++) { await page.keyboard.press('Tab'); assert.ok(await dialog.evaluate(el => el.contains(document.activeElement))); }
  await axe(page,'Crear cuenta escritorio');
  await dialog.getByRole('button', { name:'Crear cuenta', exact:true }).click();
  await page.getByRole('status').filter({ hasText:'Cuenta guardada' }).waitFor();
  await page.getByRole('button', { name:'Editar nueva@example.org', exact:true }).filter({ visible:true }).waitFor();
  await page.getByRole('button', { name:'Editar analista@example.org', exact:true }).filter({ visible:true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Estado de la cuenta').selectOption('suspendido');
  conflict();
  await dialog.getByRole('button', { name:'Guardar cambios', exact:true }).click();
  await dialog.getByRole('alert').filter({ hasText:'La cuenta cambió' }).waitFor();
  await axe(page,'Conflicto de edición');
  await dialog.getByRole('button', { name:'Guardar cambios', exact:true }).click();
  await dialog.waitFor({ state:'hidden' });
  await page.getByText('Suspendido', { exact:true }).filter({ visible:true }).waitFor();
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width,height:960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`Usuarios overflow ${width}`);
    if ([390,1440].includes(width)) { await page.screenshot({ path:`.runtime/phase2/usuarios-${width}.png`,fullPage:true }); await axe(page,`Usuarios ${width}`); }
  }
  await page.setViewportSize({ width:1440,height:960 });
  await page.getByRole('link', { name:'Auditoría', exact:true }).click();
  await page.getByRole('button', { name:`Ver detalle de operación ${auditEntry.id}`, exact:true }).filter({ visible:true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByText(auditEntry.correlacion_id, { exact:true }).waitFor();
  assert.equal(await dialog.getByRole('button', { name:/Guardar|Eliminar/ }).count(),0);
  await axe(page,'Detalle auditoría');
  await page.keyboard.press('Escape');
  await page.getByLabel('Acción').selectOption('UPDATE');
  await page.getByRole('button', { name:`Ver detalle de operación ${auditEntry.id}`, exact:true }).filter({ visible:true }).waitFor();
  assert.ok(requests.some(r => r.path === '/api/v1/auditoria' && r.query.includes('accion=UPDATE')));
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({ width,height:960 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),false,`Auditoría overflow ${width}`);
    if ([390,1440].includes(width)) { await page.screenshot({ path:`.runtime/phase2/auditoria-${width}.png`,fullPage:true }); await axe(page,`Auditoría ${width}`); }
  }
  await context.close();
  assert.deepEqual(errors,[]);
  assert.deepEqual(violations,[]);
  console.log(JSON.stringify({ roles:Object.keys(roles), comprobaciones:['Navegación y URL directa según permiso','Alta pendiente de solo lectura','Protección del propio rol y estado','Edición y suspensión','Conflicto de versión','Auditoría de solo consulta y filtros','Teclado y cuatro tamaños'], auditorias_accesibilidad:audits, errores_javascript:errors.length }));
} finally { await browser.close(); }
