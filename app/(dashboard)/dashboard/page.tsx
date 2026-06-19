'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Row,
  Col,
  Card,
  Progress,
  Statistic,
  Select,
  DatePicker,
  Skeleton,
  Table,
  Tag,
  Typography,
  Space,
  Alert,
  Tooltip,
} from 'antd'
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  ThunderboltFilled,
  LinkOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { DonutChart, Legend, BarChart, MetricTilesChart } from '@/components/charts/Charts'
import { StatTitle } from '@/components/ui/StatTitle'

const BRAND = '#2da01d'
const { Title, Text } = Typography
const { RangePicker } = DatePicker

interface Analytics {
  summary: {
    totalBotRequests: number
    uniqueUrls: number
    cacheHitRate: number
    avgResponseTime: number
    avgCacheServeTime: number
    avgRenderTime: number
    totalRenders: number
  }
  botTimeline: { date: string; googlebot: number; gptbot: number; bingbot: number; others: number }[]
  botTypeSplit: { search: number; ai: number; social: number; unknown: number }
  topPages: { url: string; hits: number; uniqueBots: number; lastCrawled: string; cacheHit: boolean }[]
  renderTrend: { date: string; renders: number; cacheHits: number }[]
  usageStats: { renderCount: number; renderLimit: number; percentUsed: number; resetAt: string }
}

// Empty shape rendered before data loads or when the account has no activity yet.
// (No fake numbers — real analytics come from /api/analytics.)
const EMPTY: Analytics = {
  summary: {
    totalBotRequests: 0,
    uniqueUrls: 0,
    cacheHitRate: 0,
    avgResponseTime: 0,
    avgCacheServeTime: 0,
    avgRenderTime: 0,
    totalRenders: 0,
  },
  botTimeline: [],
  botTypeSplit: { search: 0, ai: 0, social: 0, unknown: 0 },
  topPages: [],
  renderTrend: [],
  usageStats: {
    renderCount: 0,
    renderLimit: 0,
    percentUsed: 0,
    resetAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  },
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Analytics | null>(null)
  const [sites, setSites] = useState<{ id: string; domain: string }[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [plan, setPlan] = useState<string>('free')
  // Locale/timezone date formatting only runs after mount so the server-rendered
  // HTML and the client's first render stay identical (no hydration mismatch).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Load site list + current plan once.
  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites ?? []))
      .catch(() => setSites([]))
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => d.user?.plan && setPlan(d.user.plan))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (siteId) params.set('site_id', siteId)
      if (range) {
        params.set('start_date', range[0].toISOString())
        params.set('end_date', range[1].toISOString())
      }
      const res = await fetch(`/api/analytics?${params}`)
      const json: Analytics = await res.json()
      setData(json?.summary ? json : EMPTY)
    } catch {
      setData(EMPTY)
    } finally {
      setLoading(false)
    }
  }, [siteId, range])

  useEffect(() => {
    load()
  }, [load])

  const d = data ?? EMPTY
  const hasActivity = d.summary.totalRenders > 0 || d.summary.totalBotRequests > 0

  return (
    <div style={{ padding: 24 }}>
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          marginBottom: 20,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Dashboard
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="All sites"
            style={{ minWidth: 200 }}
            value={siteId}
            onChange={setSiteId}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <RangePicker onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} />
        </Space>
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!loading && !hasActivity && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message="No bot activity yet"
          description={
            <span>
              Add a domain and finish an integration so search &amp; AI crawlers are served
              prerendered HTML. Then real analytics will appear here.{' '}
              <Link href="/integration-wizard" style={{ color: BRAND, fontWeight: 600 }}>
                Open the Integration Wizard →
              </Link>
            </span>
          }
        />
      )}

      {/* ── Usage card ──────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 20 }}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : (
          <Row align="middle" gutter={24}>
            <Col flex="auto">
              <Text strong style={{ fontSize: 16 }}>
                {d.usageStats.renderCount.toLocaleString()} of{' '}
                {d.usageStats.renderLimit.toLocaleString()} renders used this month
              </Text>
              <Tag color={BRAND} style={{ marginLeft: 8, textTransform: 'capitalize' }}>
                {plan} plan
              </Tag>
              <Progress
                percent={d.usageStats.percentUsed}
                strokeColor={d.usageStats.percentUsed > 80 ? '#ff4d4f' : BRAND}
                style={{ marginTop: 8 }}
              />
              <Text type="secondary">
                Resets on {mounted ? new Date(d.usageStats.resetAt).toLocaleDateString() : ''}
              </Text>
            </Col>
            <Col>
              {d.usageStats.percentUsed > 80 && (
                <Link href="/billing" style={{ color: BRAND, fontWeight: 600 }}>
                  Upgrade Plan →
                </Link>
              )}
            </Col>
          </Row>
        )}
      </Card>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <StatCard
          loading={loading}
          title="Total Bot Requests"
          value={d.summary.totalBotRequests}
          icon={<ThunderboltOutlined style={{ color: BRAND }} />}
          tooltip="How many times search & AI crawlers (Googlebot, GPTBot, etc.) hit your integrated domains."
        />
        <StatCard
          loading={loading}
          title="Cache Hit Rate"
          value={d.summary.cacheHitRate}
          suffix="%"
          icon={<CheckCircleOutlined style={{ color: BRAND }} />}
          tooltip="Share of bot requests served instantly from cache — no fresh render needed. Higher is better; it climbs as your pages get cached."
        />
        <StatCard
          loading={loading}
          title="Cache Response Time"
          value={d.summary.avgCacheServeTime > 0 ? d.summary.avgCacheServeTime : '—'}
          suffix={d.summary.avgCacheServeTime > 0 ? 'ms' : undefined}
          icon={<ThunderboltFilled style={{ color: BRAND }} />}
          tooltip="How fast crawlers receive your fully-rendered pages from cache. Instant serving helps Google & AI bots index your site faster. The one-time background render doesn't affect this."
        />
        <StatCard
          loading={loading}
          title="Unique URLs"
          value={d.summary.uniqueUrls}
          icon={<LinkOutlined style={{ color: BRAND }} />}
          tooltip="Number of distinct pages crawled by bots on your domains."
        />
      </Row>

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={12}>
          <Card title="Bot Activity">
            {loading ? (
              <Skeleton active />
            ) : (
              <MetricTilesChart
                labels={d.botTimeline.map((t) => t.date.length > 5 ? t.date.slice(5) : t.date)}
                series={[
                  { label: 'Googlebot', color: BRAND, points: d.botTimeline.map((t) => t.googlebot) },
                  { label: 'GPTBot', color: '#722ed1', points: d.botTimeline.map((t) => t.gptbot) },
                  { label: 'Bingbot', color: '#1677ff', points: d.botTimeline.map((t) => t.bingbot) },
                  { label: 'Others', color: '#faad14', points: d.botTimeline.map((t) => t.others) },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card title="AI vs Search">
            {loading ? (
              <Skeleton active />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <DonutChart
                  data={[
                    { label: 'Search', value: d.botTypeSplit.search, color: BRAND },
                    { label: 'AI', value: d.botTypeSplit.ai, color: '#722ed1' },
                    { label: 'Social', value: d.botTypeSplit.social, color: '#1677ff' },
                    { label: 'Unknown', value: d.botTypeSplit.unknown, color: '#bfbfbf' },
                  ]}
                />
                <Legend
                  data={[
                    { label: 'Search', value: d.botTypeSplit.search, color: BRAND },
                    { label: 'AI', value: d.botTypeSplit.ai, color: '#722ed1' },
                    { label: 'Social', value: d.botTypeSplit.social, color: '#1677ff' },
                    { label: 'Unknown', value: d.botTypeSplit.unknown, color: '#bfbfbf' },
                  ]}
                />
              </div>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card title="Renders Trend">
            {loading ? (
              <Skeleton active />
            ) : (
              <BarChart
                data={d.renderTrend.map((t) => ({ label: t.date.length > 5 ? t.date.slice(5) : t.date, value: t.renders }))}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* ── Top pages table ─────────────────────────────────────────────────── */}
      <Card title="Top Pages">
        <Table
          loading={loading}
          rowKey="url"
          pagination={false}
          dataSource={d.topPages.slice(0, 5)}
          columns={[
            { title: 'URL', dataIndex: 'url', ellipsis: true },
            { title: 'Hits', dataIndex: 'hits', width: 100 },
            { title: 'Unique Bots', dataIndex: 'uniqueBots', width: 120 },
            {
              title: (
                <StatTitle hint="HIT = served instantly from cache. MISS = wasn't cached yet, so it was rendered fresh. The first hit of any page is always a MISS — the next becomes a HIT.">
                  Cache
                </StatTitle>
              ),
              dataIndex: 'cacheHit',
              width: 100,
              render: (hit: boolean) =>
                hit ? (
                  <Tooltip title="Served instantly from cache — no render needed.">
                    <Tag color="green">HIT</Tag>
                  </Tooltip>
                ) : (
                  <Tooltip title="Wasn't cached yet, so it was rendered fresh this time. The first hit is always a MISS; the next will be a HIT.">
                    <Tag color="default">MISS</Tag>
                  </Tooltip>
                ),
            },
            {
              title: 'Last Crawled',
              dataIndex: 'lastCrawled',
              width: 180,
              render: (v: string) => (mounted ? new Date(v).toLocaleString() : ''),
            },
          ]}
        />
      </Card>
    </div>
  )
}

function StatCard({
  loading,
  title,
  value,
  suffix,
  icon,
  tooltip,
}: {
  loading: boolean
  title: string
  value: number | string
  suffix?: string
  icon: React.ReactNode
  tooltip?: string
}) {
  const titleNode = tooltip ? (
    <Space size={4}>
      {title}
      <Tooltip title={tooltip}>
        <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 12, cursor: 'help' }} />
      </Tooltip>
    </Space>
  ) : (
    title
  )
  return (
    <Col xs={12} lg={6}>
      <Card>
        {loading ? (
          <Skeleton active paragraph={false} />
        ) : (
          <Statistic title={titleNode} value={value} suffix={suffix} prefix={icon} />
        )}
      </Card>
    </Col>
  )
}
