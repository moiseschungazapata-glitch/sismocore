export const fecha = (value: string | null | undefined) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Lima' }).format(new Date(value))
  : 'Sin sincronizaciones'

export const number = (value: number, decimals = 1) => new Intl.NumberFormat('es-PE', { maximumFractionDigits: decimals, minimumFractionDigits: decimals }).format(value)

export const magnitudeScale = [
  { key: 'low', label: 'Menor de 2.5', color: '#7fb4d4' },
  { key: 'small', label: '2.5 a menos de 4', color: '#3f92ba' },
  { key: 'medium', label: '4 a menos de 6', color: '#416ec2' },
  { key: 'large', label: '6 o más', color: '#7459b7' },
  { key: 'unknown', label: 'Sin dato', color: '#7b8ca4' },
]
export function magnitudeStyle(value: number | null) {
  return magnitudeScale[value === null ? 4 : value >= 6 ? 3 : value >= 4 ? 2 : value >= 2.5 ? 1 : 0]
}
