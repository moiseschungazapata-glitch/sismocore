import { useId, type CSSProperties } from 'react'

// Decorative illustration: no live events or connection status are represented here.
const nodes = [[246, 261], [255, 406], [337, 548], [412, 662], [485, 796]]

export default function SeismicBackdrop() {
  const id = useId().replace(/:/g, '')
  return <figure className="login-map">
    <div className="login-map-heading"><span>EXPLORACIÓN SÍSMICA <span aria-hidden="true">/</span> PERÚ</span></div>
    <div className="login-map-scene" aria-hidden="true">
      <svg className="login-map-geography" viewBox="150 130 800 820" preserveAspectRatio="xMidYMid meet" focusable="false">
        <defs>
          <pattern id={`${id}-grid`} width="80" height="80" patternUnits="userSpaceOnUse"><path d="M80 0H0V80" fill="none" stroke="#69dce7" strokeWidth=".6" opacity=".22" /><circle cx="0" cy="0" r="1.6" fill="#9ceff3" opacity=".5" /></pattern>
          <linearGradient id={`${id}-scan`} x1="0" y1="0" x2="0" y2="1"><stop stopColor="#62dce7" stopOpacity="0" /><stop offset="1" stopColor="#62dce7" stopOpacity=".17" /></linearGradient>
          <radialGradient id={`${id}-light`}><stop stopColor="#65dce7" stopOpacity=".16" /><stop offset="1" stopColor="#65dce7" stopOpacity="0" /></radialGradient>
        </defs>
        <image href="/images/login-map.png" width="1122" height="1402" />
        <ellipse cx="400" cy="600" rx="440" ry="600" fill={`url(#${id}-light)`} />
        <path d="M0 0H1122V1402H0Z" fill={`url(#${id}-grid)`} />
        <g className="login-map-scan"><path d="M0-150H1122V0H0Z" fill={`url(#${id}-scan)`} /><path d="M0 0H1122" stroke="#83ecf4" strokeWidth="1.4" opacity=".55" /></g>
        <path className="login-map-link" d="M246 261Q195 340 255 406T337 548T412 662T485 796" fill="none" stroke="#72e4ed" strokeWidth="1.8" strokeDasharray="3 11" />
        {nodes.map(([x, y], i) => <g key={i} style={{ '--node-delay': `${-i * 1.15}s` } as CSSProperties}>
          <circle className="login-map-wave login-map-wave--outer" cx={x} cy={y} r="18" />
          <circle className="login-map-wave login-map-wave--inner" cx={x} cy={y} r="18" />
          <circle cx={x} cy={y} r="7" fill="#99f4fa" stroke="#42c6db" strokeWidth="2" />
          <path d={`M${x - 29} ${y}h-13m42 29v13m29-42h13m-42-29v-13`} stroke="#6edbe6" strokeWidth="1" opacity=".7" />
        </g>)}
        <g className="login-map-target" transform="translate(485 796)"><circle r="76" fill="none" stroke="#85e5ee" strokeWidth="1" strokeDasharray="70 22 5 22" opacity=".6" /></g>
      </svg>
      <span className="login-map-corner login-map-corner--tl" /><span className="login-map-corner login-map-corner--tr" /><span className="login-map-corner login-map-corner--bl" /><span className="login-map-corner login-map-corner--br" />
      <div className="login-map-signal"><div><span>SEÑAL SÍSMICA</span><span>VISUALIZACIÓN</span></div><svg viewBox="0 0 520 44" preserveAspectRatio="none" focusable="false"><path d="M0 24H90l8-3 8 6 8-7 8 4h36l8-13 8 24 8-17 8 7h28l8-5 8 8 8-12 8 10h20l8-19 8 34 8-26 8 12h20l8-4 8 7 8-15 8 10h24l8-7 8 13 8-9 8 5H520" fill="none" stroke="#65dbe7" strokeWidth="1.4" /><path className="login-map-trace" d="M0 24H90l8-3 8 6 8-7 8 4h36l8-13 8 24 8-17 8 7h28l8-5 8 8 8-12 8 10h20l8-19 8 34 8-26 8 12h20l8-4 8 7 8-15 8 10h24l8-7 8 13 8-9 8 5H520" fill="none" stroke="#d8fcff" strokeWidth="2.4" pathLength="100" strokeDasharray="9 91" /></svg></div>
    </div>
    <figcaption>Ondas y conexiones ilustrativas <span aria-hidden="true">·</span> No son eventos en tiempo real</figcaption>
  </figure>
}
