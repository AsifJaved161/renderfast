'use client'

/**
 * Lightweight, dependency-free charts (pure SVG/CSS) used by the Dashboard.
 * Kept intentionally small and readable — no external charting library.
 */

export interface Slice {
  label: string
  value: number
  color: string
}

// ─── Donut chart (hits by status) ──────────────────────────────────────────────
export function DonutChart({
  data,
  size = 180,
  thickness = 26,
  centerLabel,
  centerSub,
}: {
  data: Slice[]
  size?: number
  thickness?: number
  centerLabel?: string
  centerSub?: string
}) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  const r = (size - thickness) / 2
  const c = 2 * Math.PI * r
  let offset = 0

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#f0f0f0"
          strokeWidth={thickness}
        />
        {data.map((d, i) => {
          const len = (d.value / total) * c
          const seg = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={d.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
            >
              <title>{`${d.label}: ${d.value.toLocaleString()}`}</title>
            </circle>
          )
          offset += len
          return seg
        })}
      </g>
      {centerLabel && (
        <text
          x="50%"
          y="48%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 22, fontWeight: 700, fill: '#111827' }}
        >
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text
          x="50%"
          y="62%"
          textAnchor="middle"
          dominantBaseline="middle"
          style={{ fontSize: 11, fill: '#9ca3af' }}
        >
          {centerSub}
        </text>
      )}
    </svg>
  )
}

// ─── Legend ─────────────────────────────────────────────────────────────────────
export function Legend({ data }: { data: Slice[] }) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: d.color,
              flexShrink: 0,
            }}
          />
          <span style={{ color: '#374151', flex: 1 }}>{d.label}</span>
          <span style={{ color: '#111827', fontWeight: 600 }}>
            {d.value.toLocaleString()}
          </span>
          <span style={{ color: '#9ca3af', width: 42, textAlign: 'right' }}>
            {Math.round((d.value / total) * 100)}%
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Vertical bar chart (hits by bot) ──────────────────────────────────────────
export function BarChart({
  data,
  height = 220,
  color = '#2da01d',
}: {
  data: { label: string; value: number }[]
  height?: number
  color?: string
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height, overflowX: 'auto' }}>
      {data.map((d, i) => (
        <div
          key={`${d.label}-${i}`}
          style={{
            flex: '1 0 36px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            height: '100%',
          }}
        >
          <div
            style={{
              flex: 1,
              width: '100%',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'center',
            }}
          >
            <div
              title={`${d.label}: ${d.value.toLocaleString()}`}
              style={{
                width: '70%',
                maxWidth: 28,
                height: `${(d.value / max) * 100}%`,
                background: color,
                borderRadius: '4px 4px 0 0',
                minHeight: 2,
                transition: 'height 0.3s',
              }}
            />
          </div>
          <span
            style={{
              fontSize: 10,
              color: '#6b7280',
              marginTop: 6,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxWidth: 48,
              textAlign: 'center',
            }}
            title={d.label}
          >
            {d.label}
          </span>
        </div>
      ))}
    </div>
  )
}

// ─── Line chart (hits over time / response time) ───────────────────────────────
export interface LineSeries {
  label: string
  color: string
  points: number[]
}

export function LineChart({
  series,
  labels,
  height = 220,
  unit = '',
  fill = false,
}: {
  series: LineSeries[]
  labels: string[]
  height?: number
  unit?: string
  fill?: boolean
}) {
  const W = 760
  const H = height
  const padL = 40
  const padR = 12
  const padT = 12
  const padB = 28
  const innerW = W - padL - padR
  const innerH = H - padT - padB

  const allValues = series.flatMap((s) => s.points)
  const max = Math.max(...allValues, 1)
  const niceMax = Math.ceil(max / 4) * 4 || 4
  const n = labels.length

  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * innerW)
  const y = (v: number) => padT + innerH - (v / niceMax) * innerH

  const gridLines = [0, 0.25, 0.5, 0.75, 1]

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      style={{ display: 'block' }}
    >
      {/* horizontal grid + y labels */}
      {gridLines.map((g, i) => {
        const yy = padT + innerH - g * innerH
        return (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={yy} y2={yy} stroke="#f0f0f0" strokeWidth={1} />
            <text x={padL - 8} y={yy + 3} textAnchor="end" style={{ fontSize: 10, fill: '#9ca3af' }}>
              {Math.round(niceMax * g)}
            </text>
          </g>
        )
      })}

      {/* x labels */}
      {labels.map((lab, i) => (
        <text
          key={lab + i}
          x={x(i)}
          y={H - 8}
          textAnchor="middle"
          style={{ fontSize: 10, fill: '#9ca3af' }}
        >
          {lab}
        </text>
      ))}

      {/* series */}
      {series.map((s) => {
        const path = s.points.map((v, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(v)}`).join(' ')
        const areaPath =
          `${path} L ${x(s.points.length - 1)} ${padT + innerH} L ${x(0)} ${padT + innerH} Z`
        return (
          <g key={s.label}>
            {fill && <path d={areaPath} fill={s.color} fillOpacity={0.12} stroke="none" />}
            <path
              d={path}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
            {s.points.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}>
                <title>{`${labels[i]} — ${s.label}: ${v.toLocaleString()}${unit}`}</title>
              </circle>
            ))}
          </g>
        )
      })}
    </svg>
  )
}
