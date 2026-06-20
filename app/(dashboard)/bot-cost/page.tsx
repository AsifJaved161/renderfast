'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Row,
  Col,
  Card,
  Alert,
  Empty,
  Typography,
  Skeleton,
  Statistic,
  Table,
  Segmented,
  Tag,
  Tooltip,
} from 'antd'
import { DollarOutlined, CloudServerOutlined, ApiOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { MetricTilesChart, CHART_PALETTE } from '@/components/charts/Charts'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text } = Typography

type RangeKey = '7d' | '30d' | '90d'

interface PerBot {
  botName: string
  requests: number
  gb: number
  estimatedCostUsd: number
}
interface RateUsed {
  ratePerGbUsd: number
  effectiveFrom: string
  effectiveTo: string | null
}
interface Summary {
  domain: string
  rangeKey: RangeKey
  range: { from: string; to: string }
  perBot: PerBot[]
  totals: { requests: number; gb: number; estimatedCostUsd: number }
  timeSeries: { date: string; gb: number; estimatedCostUsd: number }[]
  ratesUsed: RateUsed[]
  rateSource: string
  isEstimate: true
}

const usd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n < 1 ? 4 : 2 })
const num = (n: number) => n.toLocaleString()

// Bot Cost Insights — estimated bandwidth cost of bot traffic, per crawler.
// The figure is an ESTIMATE based on an admin-set industry-average $/GB rate; it
// is explicitly NOT the customer's actual hosting bill (see disclaimer below).
export default function BotCostPage() {
  const { selectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const [range, setRange] = useState<RangeKey>('30d')
  const [data, setData] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/bot-cost/${siteId}?range=${range}`)
      setData(res.ok ? await res.json() : null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [siteId, range])

  useEffect(() => {
    load()
  }, [load])

  // Disclaimer rate: the single current rate, or a min–max span if it changed
  // mid-range — so the copy is accurate even across a rate change.
  const rateLabel = useMemo(() => {
    const rates = data?.ratesUsed ?? []
    if (rates.length === 0) return null
    const vals = rates.map((r) => r.ratePerGbUsd)
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    return min === max ? `$${min}/GB` : `$${min}–$${max}/GB`
  }, [data])

  const series = useMemo(() => {
    const ts = data?.timeSeries ?? []
    return {
      labels: ts.map((t) => t.date.slice(5)), // MM-DD
      tiles: [
        { label: 'GB Served', color: BRAND, points: ts.map((t) => t.gb) },
        { label: 'Est. Cost ($)', color: '#1677ff', points: ts.map((t) => t.estimatedCostUsd) },
      ],
    }
  }, [data])

  const totals = data?.totals

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Bot Cost Insights
          </Title>
          <Text type="secondary">
            Estimated bandwidth cost of crawler traffic, broken down per bot.
          </Text>
        </div>
        <Segmented
          value={range}
          onChange={(v) => setRange(v as RangeKey)}
          options={[
            { label: 'Last 7 days', value: '7d' },
            { label: 'Last 30 days', value: '30d' },
            { label: 'Last 90 days', value: '90d' },
          ]}
        />
      </div>

      {/* ── Persistent estimate disclaimer (always visible, near the top) ─────── */}
      <Alert
        type="info"
        showIcon
        icon={<InfoCircleOutlined />}
        style={{ marginBottom: 16 }}
        message="These figures are estimates — not your actual hosting bill"
        description={
          <span>
            Estimated bandwidth cost of bot traffic, based on an industry-average rate of{' '}
            <strong>{rateLabel ?? '$0.08/GB'}</strong>
            {data?.rateSource ? ` (${data.rateSource})` : ''}. Your real cost depends on your own
            hosting/CDN provider and plan.
          </span>
        }
      />

      {!siteId ? (
        <Card>
          <Empty description="Select a site to view its bot cost insights." />
        </Card>
      ) : loading && !data ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : !data || (data.totals.requests === 0 && data.perBot.length === 0) ? (
        <Card>
          <Empty description="No bot traffic recorded for this site in the selected range yet." />
        </Card>
      ) : (
        <>
          {/* ── Totals ──────────────────────────────────────────────────────────── */}
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={8}>
              <Card>
                <Statistic
                  title="Estimated Cost"
                  value={totals?.estimatedCostUsd ?? 0}
                  formatter={(v) => usd(Number(v))}
                  prefix={<DollarOutlined style={{ color: BRAND }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8}>
              <Card>
                <Statistic
                  title="Bandwidth Served"
                  value={totals?.gb ?? 0}
                  suffix="GB"
                  precision={2}
                  prefix={<CloudServerOutlined style={{ color: BRAND }} />}
                />
              </Card>
            </Col>
            <Col xs={12} sm={8}>
              <Card>
                <Statistic
                  title="Bot Requests"
                  value={totals?.requests ?? 0}
                  prefix={<ApiOutlined style={{ color: BRAND }} />}
                />
              </Card>
            </Col>
          </Row>

          {/* ── Time series ─────────────────────────────────────────────────────── */}
          <Card title="Bandwidth & estimated cost over time" style={{ marginBottom: 16 }}>
            {series.labels.length > 0 ? (
              <MetricTilesChart labels={series.labels} series={series.tiles} />
            ) : (
              <Text type="secondary">No daily data for this range yet.</Text>
            )}
          </Card>

          {/* ── Per-bot breakdown ───────────────────────────────────────────────── */}
          <Card
            title="Cost by bot"
            extra={
              data.ratesUsed.length > 1 ? (
                <Tooltip title="The bandwidth rate changed during this range; each day is costed with the rate that was active that day.">
                  <Tag color="orange">Rate changed mid-range</Tag>
                </Tooltip>
              ) : null
            }
          >
            <Table<PerBot>
              size="small"
              rowKey="botName"
              pagination={false}
              dataSource={data.perBot}
              columns={[
                {
                  title: 'Bot',
                  dataIndex: 'botName',
                  render: (name: string, _r, i) => (
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: CHART_PALETTE[i % CHART_PALETTE.length],
                          flexShrink: 0,
                        }}
                      />
                      {name}
                    </span>
                  ),
                },
                {
                  title: 'Requests',
                  dataIndex: 'requests',
                  align: 'right',
                  sorter: (a, b) => a.requests - b.requests,
                  render: (v: number) => num(v),
                },
                {
                  title: 'GB Served',
                  dataIndex: 'gb',
                  align: 'right',
                  sorter: (a, b) => a.gb - b.gb,
                  render: (v: number) => v.toFixed(2),
                },
                {
                  title: 'Est. Cost',
                  dataIndex: 'estimatedCostUsd',
                  align: 'right',
                  defaultSortOrder: 'descend',
                  sorter: (a, b) => a.estimatedCostUsd - b.estimatedCostUsd,
                  render: (v: number) => <strong>{usd(v)}</strong>,
                },
              ]}
              summary={(rows) => {
                const r = rows.reduce(
                  (acc, x) => ({ req: acc.req + x.requests, gb: acc.gb + x.gb, cost: acc.cost + x.estimatedCostUsd }),
                  { req: 0, gb: 0, cost: 0 }
                )
                return (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0}>
                      <strong>Total</strong>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={1} align="right">
                      {num(r.req)}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={2} align="right">
                      {r.gb.toFixed(2)}
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={3} align="right">
                      <strong>{usd(r.cost)}</strong>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )
              }}
            />
          </Card>
        </>
      )}
    </div>
  )
}
