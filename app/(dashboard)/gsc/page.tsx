'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Button,
  Alert,
  Typography,
  Statistic,
  Table,
  Tag,
  Space,
  Skeleton,
  Popconfirm,
  message,
} from 'antd'
import {
  GoogleOutlined,
  DisconnectOutlined,
  ReloadOutlined,
  RiseOutlined,
  EyeOutlined,
  AimOutlined,
  PercentageOutlined,
} from '@ant-design/icons'
import { LineChart } from '@/components/charts/Charts'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

interface Metrics {
  connected: boolean
  property?: string | null
  message?: string
  totals?: { clicks: number; impressions: number; ctr: number; position: number }
  timeline?: { date: string; clicks: number; impressions: number }[]
  topQueries?: { query: string; clicks: number; impressions: number; ctr: number; position: number }[]
  topPages?: { page: string; clicks: number; impressions: number; ctr: number; position: number }[]
}

const ERROR_TEXT: Record<string, string> = {
  not_configured: 'Google OAuth isn’t configured yet. Add the Google client credentials to enable this.',
  bad_state: 'Connection could not be verified (state mismatch). Please try again.',
  missing_code: 'Google did not return an authorization code. Please try again.',
  exchange_failed: 'Could not complete the Google sign-in. Please try again.',
  access_denied: 'You declined the Google permission request.',
}

export default function GscPage() {
  const { sites, selectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const [status, setStatus] = useState<{ connected: boolean; configured: boolean; email: string | null } | null>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [loadingMetrics, setLoadingMetrics] = useState(false)

  // Surface ?connected / ?error from the OAuth redirect, then clean the URL.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('connected')) message.success('Google Search Console connected.')
    const err = params.get('error')
    if (err) message.error(ERROR_TEXT[err] ?? 'Could not connect Google Search Console.')
    if (params.get('connected') || err) {
      window.history.replaceState({}, '', '/gsc')
    }
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/gsc')
      const d = await res.json()
      setStatus({ connected: !!d.connected, configured: d.configured !== false, email: d.email ?? null })
    } catch {
      setStatus({ connected: false, configured: true, email: null })
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const loadMetrics = useCallback(async () => {
    if (!siteId || !status?.connected) return
    setLoadingMetrics(true)
    try {
      const res = await fetch(`/api/gsc/metrics?site_id=${siteId}`)
      const d = await res.json()
      setMetrics(d)
    } catch {
      setMetrics(null)
    } finally {
      setLoadingMetrics(false)
    }
  }, [siteId, status?.connected])

  useEffect(() => {
    loadMetrics()
  }, [loadMetrics])

  function connect() {
    // Full-page navigation so the session cookie reaches /api/gsc/connect.
    window.location.href = '/api/gsc/connect'
  }

  async function disconnect() {
    await fetch('/api/gsc', { method: 'DELETE' })
    setMetrics(null)
    message.success('Disconnected.')
    loadStatus()
  }

  // ── Not connected ────────────────────────────────────────────────────────────
  if (status && !status.connected) {
    return (
      <div style={{ padding: 24 }}>
        <Title level={3}>Google Search Console</Title>
        {!status.configured && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="OAuth not configured"
            description="Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GOOGLE_OAUTH_REDIRECT_URI to enable Google sign-in."
          />
        )}
        <Card>
          <Row align="middle" gutter={24}>
            <Col flex="auto">
              <Space align="start" size={16}>
                <GoogleOutlined style={{ fontSize: 40, color: '#4285F4' }} />
                <div>
                  <Title level={4} style={{ margin: 0 }}>
                    Connect Google Search Console
                  </Title>
                  <Paragraph type="secondary" style={{ margin: '4px 0 0', maxWidth: 520 }}>
                    Link your GSC account to see clicks, impressions, average position and your
                    top queries & pages right inside RenderForAI. Read-only — we never change
                    anything in your Search Console.
                  </Paragraph>
                </div>
              </Space>
            </Col>
            <Col>
              <Button
                type="primary"
                icon={<GoogleOutlined />}
                onClick={connect}
                disabled={!status.configured}
                style={{ background: BRAND, borderColor: BRAND }}
              >
                Connect with Google
              </Button>
            </Col>
          </Row>
        </Card>
      </div>
    )
  }

  const totals = metrics?.totals

  // ── Connected ────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Google Search Console
        </Title>
        <Space wrap>
          {status?.email && (
            <Tag icon={<GoogleOutlined />} color="blue">
              {status.email}
            </Tag>
          )}
          <Button icon={<ReloadOutlined />} onClick={loadMetrics} loading={loadingMetrics}>
            Refresh
          </Button>
          <Popconfirm title="Disconnect Google Search Console?" onConfirm={disconnect} okText="Disconnect">
            <Button danger icon={<DisconnectOutlined />}>
              Disconnect
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {!status ? (
        <Skeleton active />
      ) : metrics && metrics.property === null ? (
        <Alert
          type="info"
          showIcon
          message="No matching property"
          description={metrics.message}
        />
      ) : loadingMetrics && !metrics ? (
        <Skeleton active paragraph={{ rows: 6 }} />
      ) : (
        <>
          {/* Totals */}
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

          {/* Timeline */}
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

          {/* Top queries + pages */}
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
