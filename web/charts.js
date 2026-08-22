/**
 * Charts, hand-rolled in SVG.
 *
 * The spec called for Recharts, which would mean React, a bundler, and a build
 * step between an edit and a running demo. These two charts are the only ones
 * the product needs, and drawn directly they cost ~120 lines, no dependency,
 * and work offline. Same visual language: thin axes, no heavy gridlines, one
 * accent colour.
 *
 * Restyled to the Project Delivery palette: flat fills instead of gradients,
 * square line joins and markers, and a 3px stroke that survives a printout or
 * a high-contrast mode.
 */

const ACCENT = '#1d70b8'

const escapeText = (s) =>
  String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))

/** Catmull-Rom → cubic Bézier, so the area reads as a trend and not a polygon. */
function smoothPath(points) {
  if (points.length < 2) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const c1x = p1.x + (p2.x - p0.x) / 6
    const c1y = p1.y + (p2.y - p0.y) / 6
    const c2x = p2.x - (p3.x - p1.x) / 6
    const c2y = p2.y - (p3.y - p1.y) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x} ${p2.y}`
  }
  return d
}

/** Round an axis maximum up to something a person would choose. */
function niceMax(value) {
  if (value <= 0) return 10
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

/**
 * Area chart. `series` is [{ label, value }] in chronological order.
 */
export function areaChart(series, { height = 260 } = {}) {
  const W = 720
  const H = height
  const pad = { top: 16, right: 8, bottom: 30, left: 48 }
  const innerW = W - pad.left - pad.right
  const innerH = H - pad.top - pad.bottom

  if (series.length === 0) {
    return `<div class="empty">Sin actividad en el período.</div>`
  }

  const max = niceMax(Math.max(...series.map((d) => d.value), 1))
  const stepX = series.length > 1 ? innerW / (series.length - 1) : 0

  const points = series.map((d, i) => ({
    x: +(pad.left + i * stepX).toFixed(1),
    y: +(pad.top + innerH - (d.value / max) * innerH).toFixed(1),
  }))

  const line = smoothPath(points)
  const area = `${line} L ${points.at(-1).x} ${pad.top + innerH} L ${points[0].x} ${pad.top + innerH} Z`

  const ticks = [0, 0.5, 1].map((t) => {
    const y = pad.top + innerH - t * innerH
    return `<line class="gridline" x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"/>
      <text class="axis" x="${pad.left - 10}" y="${y + 4}" text-anchor="end">${Math.round(max * t).toLocaleString('es-CR')}</text>`
  }).join('')

  // Label every other day so they never collide.
  const labels = series.map((d, i) =>
    i % 2 === 0 || i === series.length - 1
      ? `<text class="axis" x="${points[i].x}" y="${H - 8}" text-anchor="middle">${escapeText(d.label)}</text>`
      : '',
  ).join('')

  // Square markers rather than circles: this system avoids rounded shapes.
  const dots = points.map((p, i) =>
    i === points.length - 1
      ? `<rect x="${p.x - 4}" y="${p.y - 4}" width="8" height="8" fill="${ACCENT}"/>`
      : '',
  ).join('')

  return `
  <svg class="chart" viewBox="0 0 ${W} ${H}" role="img"
       aria-label="Actividad de donaciones por día">
    ${ticks}
    <path d="${area}" fill="${ACCENT}" fill-opacity="0.12"/>
    <path d="${line}" fill="none" stroke="${ACCENT}" stroke-width="3"
          stroke-linecap="square" stroke-linejoin="miter"/>
    ${dots}
    ${labels}
  </svg>`
}

/**
 * Donut. `slices` is [{ label, value, color }].
 */
export function donutChart(slices, { size = 200, thickness = 26 } = {}) {
  const total = slices.reduce((sum, s) => sum + s.value, 0)
  const r = size / 2 - thickness / 2
  const c = size / 2
  const circumference = 2 * Math.PI * r

  if (total === 0) {
    return `<svg class="chart" viewBox="0 0 ${size} ${size}" role="img" aria-label="Sin datos">
      <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#cecece" stroke-width="${thickness}"/>
    </svg>`
  }

  let offset = 0
  const arcs = slices.filter((s) => s.value > 0).map((s) => {
    const fraction = s.value / total
    // A 1px gap between segments so adjacent slices stay legible.
    const dash = Math.max(circumference * fraction - 2, 1)
    const arc = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${s.color}"
      stroke-width="${thickness}" stroke-linecap="butt"
      stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
      stroke-dashoffset="${(-offset).toFixed(2)}"
      transform="rotate(-90 ${c} ${c})"><title>${escapeText(s.label)}</title></circle>`
    offset += circumference * fraction
    return arc
  }).join('')

  const headline = slices[0] ? Math.round((slices[0].value / total) * 1000) / 10 : 0

  return `
  <svg class="chart" viewBox="0 0 ${size} ${size}" style="max-width:${size}px;margin:0 auto"
       role="img" aria-label="Distribución por estado de cumplimiento">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#f3f2f1" stroke-width="${thickness}"/>
    ${arcs}
    <text x="${c}" y="${c - 2}" text-anchor="middle"
          style="font-size:30px;font-weight:700;fill:#0b0c0c">${headline}%</text>
    <text x="${c}" y="${c + 20}" text-anchor="middle"
          style="font-size:15px;fill:#484949">verificadas</text>
  </svg>`
}
