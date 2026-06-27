'use client'

import { useState, useEffect } from 'react'

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

// Distinct, accessible palette so each bar/category reads as its own colour.
export const CHART_PALETTE = [
  '#2da01d', '#1677ff', '#722ed1', '#fa8c16', '#13c2c2',
  '#eb2f96', '#f5222d', '#faad14', '#2f54eb', '#52c41a',
]

// ─── Vertical bar chart (hits by bot) ──────────────────────────────────────────
export function BarChart({
  data,
  height = 220,
  colors = CHART_PALETTE,
  unit,
}: {
  data: { label: string; value: number }[]
  height?: number
  colors?: string[]
  unit?: string // appended to the hover tooltip, e.g. "renders" → "06-23: 24 renders"
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, height, overflowX: 'auto', paddingTop: 8 }}>
      {data.map((d, i) => {
        const color = colors[i % colors.length]
        return (
          <div
            key={`${d.label}-${i}`}
            style={{ flex: '1 0 44px', display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%' }}
          >
            {/* bar + value label on top */}
            <div style={{ flex: 1, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end' }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 4 }}>
                {d.value.toLocaleString()}
              </span>
              <div
                title={`${d.label}: ${d.value.toLocaleString()}${unit ? ` ${unit}` : ''}`}
                style={{
                  width: '68%',
                  maxWidth: 34,
                  height: `${(d.value / max) * 100}%`,
                  background: `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)`,
                  borderRadius: '6px 6px 0 0',
                  minHeight: 4,
                  boxShadow: `0 1px 4px ${color}33`,
                  transition: 'height 0.3s',
                }}
              />
            </div>
            <span
              style={{
                fontSize: 11,
                color: '#6b7280',
                marginTop: 8,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 60,
                textAlign: 'center',
              }}
              title={d.label}
            >
              {d.label}
            </span>
          </div>
        )
      })}
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
  showLegend = true,
  showDots = true,
  showValueLabels = false,
}: {
  series: LineSeries[]
  labels: string[]
  height?: number
  unit?: string
  fill?: boolean
  showLegend?: boolean
  showDots?: boolean
  showValueLabels?: boolean
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
    <div>
      {showLegend && series.length > 1 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 10, justifyContent: 'center' }}>
          {series.map((s) => (
            <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#374151' }}>
              <span style={{ width: 14, height: 3, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
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
            {showDots &&
              s.points.map((v, i) => {
                const isLast = i === s.points.length - 1
                return (
                  <circle
                    key={i}
                    cx={x(i)}
                    cy={y(v)}
                    r={isLast ? 4 : 3}
                    fill={isLast ? '#ffffff' : s.color}
                    stroke={s.color}
                    strokeWidth={isLast ? 2.5 : 0}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>{`${labels[i]} — ${s.label}: ${v.toLocaleString()}${unit}`}</title>
                  </circle>
                )
              })}
            {showValueLabels &&
              s.points.map((v, i) => (
                <text
                  key={`lbl-${i}`}
                  x={x(i)}
                  y={Math.max(padT + 10, y(v) - 8)}
                  textAnchor="middle"
                  style={{ fontSize: 11, fill: s.color, fontWeight: 700 }}
                >
                  {v.toLocaleString()}
                </text>
              ))}
          </g>
        )
      })}
      </svg>
    </div>
  )
}

// ─── GSC-style metric tiles + toggleable multi-line chart ──────────────────────
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'K'
  return String(n)
}

export interface MetricSeries {
  label: string
  color: string
  points: number[]
}

// Coloured summary tiles (like Google Search Console) that toggle each line on
// the chart below. Tiles act as the legend + an interactive filter.
export function MetricTilesChart({
  series,
  labels,
  height = 240,
}: {
  series: MetricSeries[]
  labels: string[]
  height?: number
}) {
  const [active, setActive] = useState<boolean[]>(() => series.map(() => true))
  // Keep the toggle array in sync if the number of series changes.
  useEffect(() => {
    setActive((prev) => series.map((_, i) => prev[i] ?? true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [series.length])

  const totals = series.map((s) => s.points.reduce((a, b) => a + b, 0))
  const shown = series.filter((_, i) => active[i])
  const toggle = (i: number) =>
    setActive((p) => {
      const next = p.map((v, j) => (j === i ? !v : v))
      return next.some(Boolean) ? next : p // keep at least one line visible
    })

  return (
    <div>
      {/* tiles */}
      <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', marginBottom: 18, borderRadius: 10, overflow: 'hidden' }}>
        {series.map((s, i) => {
          const on = active[i]
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => toggle(i)}
              style={{
                flex: '1 1 110px',
                minWidth: 110,
                textAlign: 'left',
                padding: '12px 14px',
                border: 'none',
                cursor: 'pointer',
                background: on ? s.color : '#fafafa',
                color: on ? '#fff' : '#9ca3af',
                boxShadow: 'inset 0 0 0 1px #f0f0f0',
                transition: 'background 0.2s, color 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600 }}>
                <span
                  style={{
                    width: 13,
                    height: 13,
                    borderRadius: 3,
                    border: `2px solid ${on ? '#fff' : s.color}`,
                    background: on ? '#fff' : 'transparent',
                    display: 'inline-block',
                    flexShrink: 0,
                  }}
                />
                {s.label}
              </div>
              <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, lineHeight: 1 }}>{fmtCompact(totals[i])}</div>
            </button>
          )
        })}
      </div>

      <LineChart labels={labels} series={shown} height={height} showLegend={false} />
    </div>
  )
}
