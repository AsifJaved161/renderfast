'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Row, Col, Card, Alert, Empty, Typography, Skeleton, Statistic, Table } from 'antd'
import { GoogleOutlined, RiseOutlined, EyeOutlined, AimOutlined, PercentageOutlined } from '@ant-design/icons'
import { LineChart } from '@/components/charts/Charts'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text } = Typography

interface Metrics {
  connected: boolean
  property?: string | null
  message?: string
  totals?: { clicks: number; impressions: number; ctr: number; position: number }
  timeline?: { date: string; clicks: number; impressions: number }[]
  topQueries?: { query: string; clicks: number; impressions: number; ctr: number; position: number }[]
  topPages?: { page: string; clicks: number; impressions: number; ctr: number; position: number }[]
}

// SEO Insights shows Google Search Console performance for the selected site.
// Connecting/disconnecting GSC is managed on the dedicated /gsc page.
export default function InsightPage() {
  const { selectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const [connected, setConnected] = useState<boolean | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetch('/api/gsc')
      .then((r) => r.json())
      .then((d) => setConnected(!!d.connected))
      .catch(() => setConnected(false))
  }, [])

  const loadMetrics = useCallback(async () => {
    if (!siteId || !connected) return
    setLoading(true)
    try {
      const res = await fetch(`/api/gsc/metrics?site_id=${siteId}`)
      setMetrics(await res.json())
    } catch {
      setMetrics(null)
    } finally {
      setLoading(false)
    }
  }, [siteId, connected])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  const totals = metrics?.totals

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          SEO Insights
        </Title>
        <Text type="secondary">
          Search performance from Google Search Console — impressions, clicks, position & top queries.
        </Text>
      </div>

      {/* ── Not connected: prompt to connect on the GSC page ─────────────────── */}
      {connected === false && (
        <Alert
          type="info"
          showIcon
          icon={<GoogleOutlined />}
          message="Connect Google Search Console for richer insights"
          description={
            <span>
              Impressions, clicks, average position and your top queries & pages will appear here
              once GSC is connected.{' '}
              <Link href="/gsc" style={{ color: BRAND, fontWeight: 600 }}>
                Connect now →
              </Link>
            </span>
          }
        />
      )}

      {connected === null ? (
        <Card>
          <Skeleton active paragraph={{ rows: 4 }} />
        </Card>
      ) : connected === false ? null : !siteId ? (
        <Card style={{ marginTop: 16 }}>
          <Empty description="Select a site to view its Search Console data." />
        </Card>
      ) : metrics && metrics.property === null ? (
        <Alert style={{ marginTop: 16 }} type="info" showIcon message="No matching property" description={metrics.message} />
      ) : loading && !metrics ? (
        <Card style={{ marginTop: 16 }}>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={12} lg={6}>
              <Card>
                <Statistic title="Clicks (28d)" value={totals?.clicks ?? 0} prefix={<RiseOutlined style={{ color: BRAND }} />} />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card>
                <Statistic title="Impressions (28d)" value={totals?.impressions ?? 0} prefix={<EyeOutlined style={{ color: BRAND }} />} />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card>
                <Statistic title="Avg CTR" value={totals?.ctr ?? 0} suffix="%" prefix={<PercentageOutlined style={{ color: BRAND }} />} />
              </Card>
            </Col>
            <Col xs={12} lg={6}>
              <Card>
                <Statistic title="Avg Position" value={totals?.position ?? 0} prefix={<AimOutlined style={{ color: BRAND }} />} />
              </Card>
            </Col>
          </Row>

          <Card title="Clicks & Impressions (28 days)" style={{ marginBottom: 16 }}>
            {metrics?.timeline && metrics.timeline.length > 0 ? (
              <LineChart
                labels={metrics.timeline.map((t) => t.date.slice(5))}
                series={[
                  { label: 'Clicks', color: BRAND, points: metrics.timeline.map((t) => t.clicks) },
                  { label: 'Impressions', color: '#1677ff', points: metrics.timeline.map((t) => t.impressions) },
                ]}
              />
            ) : (
              <Text type="secondary">No data for this range yet.</Text>
            )}
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card title="Top Queries">
                <Table
                  size="small"
                  rowKey="query"
                  pagination={false}
                  dataSource={metrics?.topQueries ?? []}
                  columns={[
                    { title: 'Query', dataIndex: 'query', ellipsis: true },
                    { title: 'Clicks', dataIndex: 'clicks', width: 80 },
                    { title: 'Impr.', dataIndex: 'impressions', width: 80 },
                    { title: 'Pos.', dataIndex: 'position', width: 70 },
                  ]}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card title="Top Pages">
                <Table
                  size="small"
                  rowKey="page"
                  pagination={false}
                  dataSource={metrics?.topPages ?? []}
                  columns={[
                    {
                      title: 'Page',
                      dataIndex: 'page',
                      ellipsis: true,
                      render: (u: string) => (
                        <a href={u} target="_blank" rel="noopener noreferrer">
                          {u}
                        </a>
                      ),
                    },
                    { title: 'Clicks', dataIndex: 'clicks', width: 80 },
                    { title: 'Impr.', dataIndex: 'impressions', width: 80 },
                    { title: 'Pos.', dataIndex: 'position', width: 70 },
                  ]}
                />
              </Card>
            </Col>
          </Row>
        </>
      )}
    </div>
  )
}
