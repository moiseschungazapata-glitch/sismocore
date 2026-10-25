import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href)
const base = process.env.SMOKE_URL || 'http://127.0.0.1:5179'
const id = '22222222-2222-4222-8222-222222222222', modelId = '33333333-3333-4333-8333-333333333333'
const partition = { entrenamiento: 80, evaluacion: 20, inicio_entrenamiento: '2026-01-01T00:00:00Z', fin_entrenamiento: '2026-01-03T00:00:00Z', inicio_evaluacion: '2026-01-04T00:00:00Z', fin_evaluacion: '2026-01-05T00:00:00Z', metodo: 'holdout_temporal', dataset_sha256: 'a'.repeat(64) }
const dataset = { id, nombre: 'Catálogo IGP', version: 1, estado: 'borrador', numero_filas: 100, creado_en: '2026-10-25T12:00:00Z', snapshot_sha256: 'a'.repeat(64), particion_temporal: partition, informe_calidad: { recibidos: 102, validos: 100, descartados: 1, duplicados: 1, nulos: { magnitud: 1 } } }
const model = { id: modelId, nombre: 'Experimento IGP', version: 1, dataset_id: id, objetivo: 'Análisis retrospectivo de profundidad', tarea: 'regresion', algoritmo: 'lineal_simple', features: ['magnitud'], target: 'profundidad', semilla: 42, hiperparametros: {}, versiones_librerias: { 'scikit-learn': '1.9.1' }, estado: 'evaluado', validacion: partition, metricas: { mae: 10, rmse: 12, r2: .3, n_evaluacion: 20, muestra: [{ id_externo: '2026-1', real: 30, estimado: 40 }] }, baseline: { mae: 15, rmse: 19, r2: -.1 }, limitaciones: 'Experimental. No predice terremotos.', artefacto_sha256: 'b'.repeat(64) }
const classifier = { ...model, id: '44444444-4444-4444-8444-444444444444', nombre: 'Clasificador', tarea: 'clasificacion', algoritmo: 'logistica', target: 'rango_profundidad', features: ['magnitud', 'latitud', 'longitud'], metricas: { f1: .5, precision: .6, recall: .7, brier: .3, n_evaluacion: 20, clases: ['Superficial', 'Intermedio', 'Profundo'], matriz: [[5, 1, 0], [1, 8, 0], [0, 1, 4]], calibracion: [{ n: 20, confianza: .6, acierto: .7 }], muestra: [{ id_externo: '2026-2', real: 1, estimado: 1 }] }, baseline: { f1: .3, brier: .5 } }
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
 for (const width of [1365, 390, 320]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage()
  const errors = [];page.on('pageerror', e => errors.push(e.message))
  let datasets = [], models = [], role = 'administrador', writes = 0
  await page.route('**/api/v1/**', async route => {
   const url = new URL(route.request().url()), path = url.pathname, body = route.request().postDataJSON(), method = route.request().method();let json = {}
   if (path.endsWith('/auth/me')) json = { user: { id: '11111111-1111-4111-8111-111111111111', nombre_completo: 'Prueba local', rol: role, estado: 'activo', permisos: ['catalogo.leer', 'modelos.leer', ...(role === 'administrador' ? ['modelos.entrenar', 'modelos.aprobar'] : role === 'analista' ? ['modelos.entrenar'] : [])] } }
   else if (path.endsWith('/eventos')) json = { eventos: [], total: 0, codigo_fuente: 'igp', periodo_dias: 30, consultado_en: new Date().toISOString() }
   else if (path.endsWith('/modelos')) json = { datasets, modelos: url.searchParams.get('dataset_id') ? models.filter(m => m.dataset_id === url.searchParams.get('dataset_id')) : models, pagina: 1, total: models.length, disponible: true }
   else if (path.endsWith('/modelos/datasets') && method === 'POST') { assert.equal(body.confirmado, true);datasets = [structuredClone(dataset)];json = { dataset: datasets[0] };writes++ }
   else if (path.endsWith('/publicar')) { datasets[0].estado = 'publicado';json = { dataset: datasets[0] };writes++ }
   else if (path.endsWith('/datasets/' + id)) json = { dataset: datasets[0], vista_previa: [{ id_externo: '2026-1', magnitud: 4, profundidad: 30, ocurrido_en: '2026-01-01T00:00:00Z' }], transformaciones: ['Sin imputación; orden temporal.'] }
   else if (path.endsWith('/experimentos')) { assert.equal(body.confirmado, true);assert.equal(body.dataset_id, id);models = [structuredClone(model), structuredClone(classifier)];json = { modelo: models[0] };writes++ }
   else if (path.endsWith('/aprobar')) { models[0].estado = 'aprobado';json = { modelo: models[0] };writes++ }
   else if (path.endsWith('/estimar')) { assert.equal(body.magnitud, 4);json = { resultado: { valor: 40, limite_inferior: 10, limite_superior: 70, fuera_rango: [], advertencia: 'Resultado experimental.' } };writes++ }
   else throw Error('Unexpected API request: ' + path)
   await route.fulfill({ json })
  })
  await page.route('**/health', route => route.fulfill({ json: { estado: 'ok', base_datos: 'conectada' } }))
  async function a11y() {
   if (!process.env.AXE_PATH) return
   await page.addScriptTag({ path: process.env.AXE_PATH })
   const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) })))
   assert.deepEqual(violations, [])
  }
  await page.goto(base + '/modelos');await page.getByRole('heading', { name: 'Prepara tu primer dataset' }).waitFor()
  await a11y()
  await page.getByRole('button', { name: 'Preparar dataset', exact: true }).click()
  await page.getByLabel('Confirmo la creación').check();await a11y()
  await page.locator('dialog[open]').getByRole('button', { name: 'Preparar dataset', exact: true }).click()
  await page.getByRole('button', { name: 'Revisar datos' }).click();await page.getByRole('heading', { name: 'Preparación aplicada' }).waitFor();await a11y()
  await page.locator('dialog[open]').getByRole('button', { name: 'Cerrar detalle' }).click()
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();await page.getByRole('button', { name: 'Cancelar', exact: true }).click();assert.equal(writes, 1)
  await page.getByRole('button', { name: 'Publicar', exact: true }).click();await page.getByRole('button', { name: 'Publicar dataset', exact: true }).click()
  await page.getByRole('button', { name: '2. Experimentos', exact: true }).click()
  await page.getByRole('button', { name: 'Nuevo experimento', exact: true }).click()
  await page.getByLabel('Nombre del experimento').fill('Experimento IGP');await page.getByLabel('Confirmo el entrenamiento').check();await a11y()
  await page.getByRole('button', { name: 'Entrenar modelo', exact: true }).click()
  await page.getByText('Métricas en 20 registros de evaluación', { exact: true }).waitFor();await a11y()
  await page.getByRole('button', { name: 'Revisar aprobación experimental' }).click();await page.getByRole('button', { name: 'Aprobar modelo', exact: true }).click()
  await page.getByRole('button', { name: 'Ver resultado', exact: true }).first().click();await page.getByLabel('Magnitud', { exact: true }).fill('4')
  await page.getByRole('button', { name: 'Calcular resultado experimental', exact: true }).click();await page.getByText('Profundidad estimada: 40 km', { exact: true }).waitFor();await a11y()
  await page.locator('dialog[open]').getByRole('button', { name: 'Cerrar detalle' }).click()
  await page.getByRole('button', { name: '3. Comparación', exact: true }).click();await page.getByLabel('Dataset para comparar').selectOption(id)
  await page.getByRole('heading', { name: 'Regresión · menor MAE y RMSE es mejor' }).waitFor();await a11y()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: `.runtime/ml-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Ver', exact: true }).last().click();await page.getByRole('heading', { name: 'Matriz de confusión' }).waitFor();await a11y()
  await page.locator('dialog[open]').getByRole('button', { name: 'Cerrar detalle' }).click()
  role = 'auditor';await page.reload();await page.getByRole('button', { name: 'Revisar datos' }).waitFor()
  assert.equal(await page.getByRole('button', { name: 'Preparar dataset', exact: true }).count(), 0)
  await a11y();assert.deepEqual(errors, []);assert.equal(writes, 5)
  await context.close();console.log(`ML ${width}px: dataset, publicación, entrenamiento, aprobación, consulta, comparación, permisos y accesibilidad OK.`)
 }
} finally { await browser.close() }
