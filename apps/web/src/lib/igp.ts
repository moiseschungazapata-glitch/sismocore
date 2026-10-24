export const IGP_REPORTS_URL = 'https://ultimosismo.igp.gob.pe/productos/reportes-sismicos'

// ArcGIS URLs are provenance for machines. People open the official event page.
export function igpReportUrl(event: { id_externo: string }) {
  return /^\d{4}-\d{1,5}$/.test(event.id_externo)
    ? `https://ultimosismo.igp.gob.pe/evento/${encodeURIComponent(event.id_externo)}`
    : IGP_REPORTS_URL
}
