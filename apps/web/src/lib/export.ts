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
  const sheet = workbook.addWorksheet('Eventos sísmicos', {
    views: [{ state: 'frozen', ySplit: 9, xSplit: 2, showGridLines: false }],
    pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  })
  sheet.columns = [25, 48, 13, 13, 20, 15, 15, 24, 23, 29, 62, 40].map(width => ({ width }))
  const banner = (row: number, text: string, dark = false) => {
    sheet.mergeCells(row, 1, row, 12)
    const cell = sheet.getCell(row, 1)
    cell.value = text
    cell.font = { name: 'Calibri', size: row === 1 ? 22 : 11, bold: dark, color: { argb: dark ? 'FFFFFFFF' : 'FF243B53' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: dark ? 'FF102A43' : 'FFF0F7FA' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    sheet.getRow(row).height = row === 1 ? 42 : 28
  }
  const magnitudeLabels: Record<string, string> = { todos: 'Todas', menor: 'Menor de 4', medio: '4 a menos de 6', mayor: '6 o más' }
  const magnitudes = eventos.flatMap(e => e.magnitud === null ? [] : [e.magnitud])
  const maximum = magnitudes.length ? Math.max(...magnitudes).toFixed(1) : 'Sin dato'
  const depth = eventos.length ? (eventos.reduce((total, e) => total + e.profundidad, 0) / eventos.length).toFixed(1) + ' km' : 'Sin dato'
  banner(1, 'SISMOCORE | Reporte de eventos sísmicos', true)
  banner(2, `Fuente: IGP / CENSIS · Cobertura: reportes del Perú en los últimos ${context.days ?? 30} días`)
  banner(3, `Generado: ${horaPeru(generatedAt)} · Hora de Perú (UTC−05:00)`)
  if (context.requestedBy) sheet.getCell('A3').value += ` · Solicitado por: ${context.requestedBy}`
  banner(4, `Última sincronización: ${context.lastSync ? horaPeru(new Date(context.lastSync)) : 'Sin sincronizaciones registradas'}`)
  banner(5, `Filtros · Búsqueda: ${context.filters.q || 'Sin búsqueda'} · Magnitud: ${magnitudeLabels[context.filters.magnitude] || 'Todas'} · Desde (UTC): ${context.filters.since || 'Todo el periodo disponible'}`)
  banner(6, `Eventos: ${eventos.length}   |   Magnitud máxima: ${maximum}   |   Profundidad promedio: ${depth}`, true)
  banner(7, 'Observaciones registradas por la fuente. Este reporte no constituye una predicción ni una alerta oficial.')
  if (context.cutoff) sheet.getCell('A7').value += ` Corte UTC: ${context.cutoff}. Referencia: ${context.exportId || 'Sin referencia'}.`
  sheet.getRow(8).height = 12
  sheet.addTable({
    name: 'EventosSismicos', ref: 'A9', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: ['Fecha y hora · Perú', 'Ubicación', 'Magnitud', 'Tipo magnitud', 'Profundidad (km)', 'Latitud', 'Longitud', 'Revisión', 'ID de origen · IGP / CENSIS', 'Fecha y hora · UTC', 'Enlace de origen', 'ID del registro'].map(name => ({ name, filterButton: true })),
    // Strings are literal cells, including source text beginning with = or +.
    rows: eventos.map(e => [
      horaPeru(new Date(e.ocurrido_en)), e.lugar, e.magnitud, e.tipo_magnitud ?? 'Sin dato',
      e.profundidad, e.latitud, e.longitud,
      e.estado_revision === 'reportado_igp' ? 'Reportado por el IGP' : e.estado_revision,
      e.id_externo, new Date(e.ocurrido_en).toISOString(), e.url_fuente, e.id,
    ]),
  })
  sheet.getRow(9).height = 32
  sheet.getRow(9).eachCell(cell => {
    cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF176B87' } }
    cell.alignment = { vertical: 'middle', wrapText: true }
  })
  eventos.forEach((event, index) => {
    const row = sheet.getRow(index + 10)
    row.height = Math.max(34, Math.ceil(event.lugar.length / 42) * 16)
    row.eachCell(cell => {
      cell.font = { name: 'Calibri', size: 11, color: { argb: 'FF243B53' } }
      cell.alignment = { vertical: 'middle', wrapText: true }
    })
    for (const column of [3, 5]) row.getCell(column).numFmt = '0.0'
    for (const column of [6, 7]) row.getCell(column).numFmt = '0.0000'
    row.getCell(11).font = { name: 'Calibri', size: 11, color: { argb: 'FF176B87' } }
  })
  sheet.pageSetup.printTitlesRow = '9:9'
  sheet.pageSetup.printArea = `A1:L${Math.max(9, eventos.length + 9)}`
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
