export type IconName = 'wave' | 'dashboard' | 'event' | 'map' | 'chart' | 'source' | 'report' | 'model' | 'alert' | 'users' | 'audit' | 'menu' | 'close' | 'refresh' | 'search' | 'filter' | 'arrow' | 'external' | 'check' | 'info' | 'clock' | 'database' | 'download' | 'chevron' | 'depth' | 'eye' | 'eyeOff' | 'mail' | 'lock' | 'logout'

const paths: Record<IconName, string> = {
  lock: 'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4 M12 14v3',
  mail: 'M3 5h18v14H3z m0 1 9 7 9-7',
  eyeOff: 'm3 3 18 18 M10 5a12 12 0 0 1 12 7 16 16 0 0 1-3 4 M6 6a18 18 0 0 0-4 6s4 7 10 7a13 13 0 0 0 5-1 M10 10a3 3 0 0 0 4 4',
  logout: 'M10 3H4v18h6 M9 12h13 m-5-5 5 5-5 5',
  wave: 'M2 12h4l3-8 5 16 3-8h5',
  dashboard: 'M3 3h7v7H3z M14 3h7v5h-7z M3 14h7v7H3z M14 12h7v9h-7z',
  event: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 11v2',
  map: 'm3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z M9 3v15 M15 6v15',
  chart: 'M4 3v17h17 M8 15v-4 M13 15V7 M18 15V4',
  source: 'M8 8H5a3 3 0 0 0-3 3v2a3 3 0 0 0 3 3h3 M16 8h3a3 3 0 0 1 3 3v2a3 3 0 0 1-3 3h-3 M7 12h10 M12 4v3 M12 17v3',
  report: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
  model: 'M9 3h6v4h4v10h-4v4H9v-4H5V7h4z M9 10h6v4H9z M2 10h3 M2 14h3 M19 10h3 M19 14h3',
  alert: 'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5z M10 21h4 M12 2v2',
  users: 'M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M2 21v-3a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v3 M17 4a4 4 0 0 1 0 7 M19 14a5 5 0 0 1 3 4v3',
  audit: 'm12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5z m-4 10 3 3 5-6',
  menu: 'M4 6h16 M4 12h16 M4 18h16', close: 'm6 6 12 12 M18 6 6 18',
  refresh: 'M20 7a9 9 0 0 0-15-2L2 8 M2 3v5h5 M4 17a9 9 0 0 0 15 2l3-3 M22 21v-5h-5',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 m5 12 6 6',
  filter: 'M3 6h18 M6 12h12 M9 18h6', arrow: 'M4 12h16 m-6-6 6 6-6 6',
  external: 'M14 3h7v7 M21 3 11 13 M10 3H4v17h17v-7',
  check: 'm5 12 4 4L19 6', info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 11v6 M12 7v1',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l4 2',
  database: 'M3 6c0-5 18-5 18 0s-18 5-18 0 M3 6v12c0 5 18 5 18 0V6 M3 12c0 5 18 5 18 0',
  download: 'M12 3v12 m-5-5 5 5 5-5 M4 16v5h16v-5',
  chevron: 'm9 5 7 7-7 7', depth: 'M4 4h16 M12 4v16 m-5-5 5 5 5-5',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
}

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg className={`icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
