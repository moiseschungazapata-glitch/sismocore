export type Filters = { q: string; magnitude: string; since: string; until: string }

export const invalidDateRange = (filters: Filters) => Boolean(filters.since && filters.until && filters.since > filters.until)
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value

export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const magnitude = params.get('magnitud') || 'todos'
  const since = params.get('desde') || ''
  const until = params.get('hasta') || ''
  return {
    q: (params.get('q') || '').slice(0, 200),
    magnitude: ['todos', 'menor', 'medio', 'mayor'].includes(magnitude) ? magnitude : 'todos',
    since: validDate(since) ? since : '',
    until: validDate(until) ? until : '',
  }
}

export function filterSearch(filters: Filters) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.magnitude !== 'todos') params.set('magnitud', filters.magnitude)
  if (filters.since) params.set('desde', filters.since)
  if (filters.until) params.set('hasta', filters.until)
  return params.size ? `?${params.toString()}` : ''
}
