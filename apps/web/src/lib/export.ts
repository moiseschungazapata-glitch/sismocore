import { igpReportUrl } from './igp.ts'
import type { EventoSismico } from '../services/api'
import type { Filters } from './filters'

type ReportContext = { filters: Filters; lastSync?: string | null; generatedAt?: Date; days?: number; requestedBy?: string; cutoff?: string; exportId?: string }
const horaPeru = (value: Date) => new Intl.DateTimeFormat('es-PE', {
  timeZone: 'America/Lima', dateStyle: 'short', timeStyle: 'medium',
}).format(value)

export async function crearReporte(eventos: EventoSismico[], context: ReportContext) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const generatedAt = context.generatedAt ?? new Date()
  workbook.creator = 'SISMOCORE'
  workbook.created = generatedAt
  workbook.title = 'Reporte de eventos sísmicos'
  // Excel dates have no timezone. Shift UTC to Peru before writing its local clock.
  const peruDate = (value: string) => new Date(new Date(value).getTime() - 5 * 3600000)
  const dateFormat = 'dd/mm/yyyy hh:mm:ss'
  const magnitudeLabels: Record<string, string> = { todos: 'Todas', menor: 'Menor de 4', medio: '4 a menos de 6', mayor: '6 o más' }
  workbook.views = [{ activeTab: 0, firstSheet: 0, visibility: 'visible', x: 0, y: 0, width: 1200, height: 800 }]
  const sheet = workbook.addWorksheet('Eventos sísmicos', {
    views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', showGridLines: false, zoomScale: 90 }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  const summary = workbook.addWorksheet('Resumen', { views: [{ showGridLines: false }] })
  const technical = workbook.addWorksheet('Detalle técnico', {
    views: [{ state: 'frozen', ySplit: 1, topLeftCell: 'A2', activeCell: 'A2', showGridLines: false, zoomScale: 90 }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.columns = [23, 48, 11, 17, 12, 12, 15, 14].map(width => ({ width }))
  technical.columns = [17, 24, 17, 25, 39, 23].map(width => ({ width }))
  sheet.addTable({
    name: 'EventosSismicos', ref: 'A1', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: ['Fecha y hora (Perú)', 'Ubicación', 'Magnitud', 'Profundidad (km)', 'Latitud', 'Longitud', 'ID IGP', 'Fuente'].map(name => ({ name, filterButton: true })),
    // Source text is always a literal value, including strings beginning with = or +.
    rows: eventos.map(e => [peruDate(e.ocurrido_en), e.lugar, e.magnitud, e.profundidad, e.latitud, e.longitud, e.id_externo, 'Ver en IGP']),
  })
  technical.addTable({
    name: 'DetalleTecnico', ref: 'A1', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: ['ID IGP', 'Fecha y hora (UTC)', 'Tipo de magnitud', 'Revisión', 'ID del registro', 'Consulta de datos'].map(name => ({ name, filterButton: true })),
    rows: eventos.map(e => [e.id_externo, new Date(e.ocurrido_en), e.tipo_magnitud ?? 'Sin dato',
      e.estado_revision === 'reportado_igp' ? 'Reportado por el IGP' : e.estado_revision, e.id, 'Datos originales (JSON)']),
  })
  for (const table of [sheet, technical]) {
    table.getRow(1).height = 30
    table.getRow(1).eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B87' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    table.pageSetup.printTitlesRow = '1:1'
    table.pageSetup.printArea = `A1:${table === sheet ? 'H' : 'F'}${Math.max(1, eventos.length + 1)}`
  }
  eventos.forEach((event, index) => {
    const row = sheet.getRow(index + 2)
    row.height = Math.max(28, Math.ceil(event.lugar.length / 43) * 14)
    const detail = technical.getRow(index + 2)
    detail.height = 28
    for (const dataRow of [row, detail]) dataRow.eachCell({ includeEmpty: true }, cell => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF243B53' } }
      cell.alignment = { vertical: 'middle' }
    })
    row.getCell(2).alignment = { vertical: 'middle', wrapText: true }
    row.getCell(1).numFmt = dateFormat
    detail.getCell(2).numFmt = dateFormat
    for (const column of [3, 4]) row.getCell(column).numFmt = '0.0'
    for (const column of [5, 6]) row.getCell(column).numFmt = '0.0000'
    row.getCell(8).value = { text: 'Ver en IGP', hyperlink: igpReportUrl(event) }
    row.getCell(8).font = { name: 'Calibri', size: 11, underline: true, color: { argb: 'FF176B87' } }
    // Technical provenance remains available separately and is explicitly labelled as JSON.
    try {
      const url = new URL(event.url_fuente)
      if (url.protocol === 'https:' || url.protocol === 'http:') {
        detail.getCell(6).value = { text: 'Datos originales (JSON)', hyperlink: event.url_fuente }
        detail.getCell(6).font = { name: 'Calibri', size: 11, underline: true, color: { argb: 'FF176B87' } }
      } else detail.getCell(6).value = event.url_fuente
    } catch { detail.getCell(6).value = event.url_fuente }
  })
  summary.columns = [{ width: 26 }, { width: 77 }]
  summary.getCell('A1').value = 'SISMOCORE'
  summary.getCell('A1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF102A43' } }
  summary.getCell('B1').value = 'Reporte de eventos sísmicos'
  summary.getCell('B1').font = { name: 'Calibri', size: 16, bold: true, color: { argb: 'FF102A43' } }
  summary.getRow(1).height = 32
  const magnitudes = eventos.flatMap(e => e.magnitud === null ? [] : [e.magnitud])
  const values: [string, string | number][] = [
    ['Fuente', 'IGP / CENSIS'],
    ['Cobertura', `Reportes del Perú en los últimos ${context.days ?? 30} días`],
    ['Generado (Perú)', horaPeru(generatedAt)],
    ['Solicitado por', context.requestedBy || 'Sin dato'],
    ['Última sincronización', context.lastSync ? horaPeru(new Date(context.lastSync)) : 'Sin sincronizaciones registradas'],
    ['Búsqueda', context.filters.q || 'Sin búsqueda'],
    ['Magnitud seleccionada', magnitudeLabels[context.filters.magnitude] || 'Todas'],
    ['Desde (UTC)', context.filters.since || 'Todo el periodo disponible'],
    ['Eventos', eventos.length],
    ['Magnitud máxima', magnitudes.length ? Math.max(...magnitudes) : 'Sin dato'],
    ['Profundidad promedio (km)', eventos.length ? eventos.reduce((total, e) => total + e.profundidad, 0) / eventos.length : 'Sin dato'],
    ['Corte (UTC)', context.cutoff || 'Sin dato'],
    ['Referencia de exportación', context.exportId || 'Sin referencia'],
    ['Observaciones', 'Datos observados por la fuente. Este reporte no constituye una predicción ni una alerta oficial.'],
  ]
  values.forEach(([label, value], index) => {
    const row = summary.getRow(index + 3)
    row.values = [label, value]
    row.height = Math.max(25, Math.ceil(String(value).length / 70) * 15)
    row.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF243B53' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    row.getCell(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF243B53' } }
    if (index % 2 === 0) row.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F7FA' } } })
  })
  for (const address of ['B12', 'B13']) summary.getCell(address).numFmt = '0.0'
  summary.pageSetup = { orientation: 'portrait', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 1, printArea: 'A1:B16' }
  return workbook
}

export async function descargarReporte(eventos: EventoSismico[], context: ReportContext) {
  const workbook = await crearReporte(eventos, context)
  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `sismocore-reporte-${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
