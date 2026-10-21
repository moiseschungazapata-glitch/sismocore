export type Filters = { q: string; magnitude: string; since: string }

export function readFilters(search: string): Filters {
  const params = new URLSearchParams(search)
  const magnitude = params.get('magnitud') || 'todos'
  const since = params.get('desde') || ''
  return {
    q: (params.get('q') || '').slice(0, 200),
    magnitude: ['todos', 'menor', 'medio', 'mayor'].includes(magnitude) ? magnitude : 'todos',
    since: /^\d{4}-\d{2}-\d{2}$/.test(since) && Number.isFinite(Date.parse(since)) ? since : '',
  }
}

export function filterSearch(filters: Filters) {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.magnitude !== 'todos') params.set('magnitud', filters.magnitude)
  if (filters.since) params.set('desde', filters.since)
  return params.size ? `?${params.toString()}` : ''
}
