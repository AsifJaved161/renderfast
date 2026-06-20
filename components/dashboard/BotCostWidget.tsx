'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, Statistic, Typography, Skeleton } from 'antd'
import { DollarOutlined, RightOutlined } from '@ant-design/icons'
import { LineChart } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Text } = Typography

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 })

interface WidgetData {
  cost: number
  rateLabel: string | null
  source: string | null
  points: number[]
  labels: string[]
}

// Lightweight Dashboard glance: this month's estimated bandwidth cost of bot
// traffic + a 30-day sparkline. Clicking opens the full Bot Cost Insights page.
// Deliberately compact — not a duplicate of the detail page.
export function BotCostWidget({ siteId }: { siteId?: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<WidgetData | null>(null)

  useEffect(() => {
    if (!siteId) {
      setData(null)
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetch(`/api/bot-cost/${siteId}?range=30d`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((j) => {
        if (cancelled) return
        const vals: number[] = (j.ratesUsed ?? []).map((r: { ratePerGbUsd: number }) => r.ratePerGbUsd)
        const rateLabel = vals.length
          ? Math.min(...vals) === Math.max(...vals)
            ? `$${Math.min(...vals)}/GB`
            : `$${Math.min(...vals)}–$${Math.max(...vals)}/GB`
          : null
        const ts: { date: string; estimatedCostUsd: number }[] = j.timeSeries ?? []
        setData({
          cost: j.totals?.estimatedCostUsd ?? 0,
          rateLabel,
          source: j.rateSource ?? null,
          points: ts.map((t) => t.estimatedCostUsd),
          labels: ts.map((t) => t.date.slice(5)),
        })
      })
      .catch(() => {
        if (!cancelled) setData(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [siteId])

  const rateLabel = data?.rateLabel ?? '$0.08/GB'

  return (
    <Card
      hoverable
      onClick={() => router.push('/bot-cost')}
      styles={{ body: { padding: 16 } }}
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <DollarOutlined style={{ color: BRAND }} />
          Estimated Bot Bandwidth Cost
        </span>
      }
      extra={<RightOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />}
    >
      {loading ? (
        <Skeleton active paragraph={{ rows: 2 }} />
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          {/* Headline + caption disclaimer */}
          <div style={{ flex: '0 0 auto', minWidth: 200 }}>
            <Statistic value={data?.cost ?? 0} formatter={(v) => usd(Number(v))} valueStyle={{ color: BRAND, fontSize: 28 }} />
            <Text type="secondary" style={{ fontSize: 11, display: 'block', maxWidth: 260, lineHeight: 1.4 }}>
              Estimated, last 30 days — based on an industry-average rate of {rateLabel}. Not your
              actual hosting bill.
            </Text>
          </div>

          {/* Compact 30-day sparkline */}
          <div style={{ flex: 1, minWidth: 220 }}>
            {data && data.points.length > 1 ? (
              <LineChart
                labels={data.labels}
                series={[{ label: 'Est. cost', color: BRAND, points: data.points }]}
                height={72}
                fill
                showLegend={false}
                showDots={false}
              />
            ) : (
              <Text type="secondary" style={{ fontSize: 12 }}>
                {siteId ? 'No bot traffic recorded yet.' : 'Select a site to see its cost trend.'}
              </Text>
            )}
          </div>
        </div>
      )}
    </Card>
  )
}
