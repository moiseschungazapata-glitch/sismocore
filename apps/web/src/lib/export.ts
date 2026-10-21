import type { EventoSismico } from '../services/api'

export function descargarCSV(eventos: EventoSismico[]) {
  const celda = (valor: unknown) => {
    let texto = String(valor ?? '')
    if (/^[=+\-@]/.test(texto)) texto = `'${texto}`
    return `"${texto.replace(/"/g, '""')}"`
  }
  const filas = [['id', 'id_externo', 'fecha_utc', 'magnitud', 'tipo_magnitud', 'lugar', 'profundidad_km', 'latitud', 'longitud', 'fuente_url'],
    ...eventos.map(e => [e.id, e.id_externo, e.ocurrido_en, e.magnitud, e.tipo_magnitud, e.lugar, e.profundidad, e.latitud, e.longitud, e.url_fuente])]
  const blob = new Blob(['\uFEFF' + filas.map(f => f.map(celda).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url; link.download = `sismocore-eventos-${new Date().toISOString().slice(0, 10)}.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

