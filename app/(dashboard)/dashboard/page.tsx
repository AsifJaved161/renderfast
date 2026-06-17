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
} from 'antd'
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  LinkOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { DonutChart, Legend, BarChart, LineChart } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Title, Text } = Typography
const { RangePicker } = DatePicker

interface Analytics {
  summary: {
    totalBotRequests: number
    uniqueUrls: number
    cacheHitRate: number
    avgResponseTime: number
    totalRenders: number
  }
  botTimeline: { date: string; googlebot: number; gptbot: number; bingbot: number; others: number }[]
  botTypeSplit: { search: number; ai: number; social: number; unknown: number }
  topPages: { url: string; hits: number; uniqueBots: number; lastCrawled: string; cacheHit: boolean }[]
  renderTrend: { date: string; renders: number; cacheHits: number }[]
  usageStats: { renderCount: number; renderLimit: number; percentUsed: number; resetAt: string }
}

// Fixed reference instant so demo timestamps are deterministic (server === client,
// avoiding hydration mismatches from Date.now()).
const DEMO_BASE = Date.UTC(2026, 5, 16, 12, 0, 0)

// Hardcoded demo fallback used when the API returns empty.
const DEMO: Analytics = {
  summary: {
    totalBotRequests: 12840,
    uniqueUrls: 342,
    cacheHitRate: 87,
    avgResponseTime: 412,
    totalRenders: 9120,
  },
  botTimeline: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({
    date: d,
    googlebot: 400 + i * 60,
    gptbot: 120 + i * 30,
    bingbot: 80 + i * 10,
    others: 60 + i * 5,
  })),
  botTypeSplit: { search: 7200, ai: 3800, social: 1400, unknown: 440 },
  topPages: Array.from({ length: 5 }, (_, i) => ({
    url: `/page-${i + 1}`,
    hits: 900 - i * 120,
    uniqueBots: 8 - i,
    lastCrawled: new Date(DEMO_BASE - i * 3600_000).toISOString(),
    cacheHit: i % 2 === 0,
  })),
  renderTrend: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d, i) => ({
    date: d,
    renders: 800 + i * 90,
    cacheHits: 600 + i * 70,
  })),
  usageStats: {
    renderCount: 9120,
    renderLimit: 25000,
    percentUsed: 36,
    resetAt: new Date(DEMO_BASE + 18 * 86400_000).toISOString(),
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
      const json: Analytics & { demo?: boolean } = await res.json()
      // Fall back to demo data if API has nothing real yet.
      setData(json.demo || json.summary.totalRenders === 0 ? DEMO : json)
    } catch {
      setData(DEMO)
    } finally {
      setLoading(false)
    }
  }, [siteId, range])

  useEffect(() => {
    load()
  }, [load])

  const d = data ?? DEMO

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
        />
        <StatCard
          loading={loading}
          title="Cache Hit Rate"
          value={d.summary.cacheHitRate}
          suffix="%"
          icon={<CheckCircleOutlined style={{ color: BRAND }} />}
        />
        <StatCard
          loading={loading}
          title="Avg Response Time"
          value={d.summary.avgResponseTime}
          suffix="ms"
          icon={<ClockCircleOutlined style={{ color: BRAND }} />}
        />
        <StatCard
          loading={loading}
          title="Unique URLs"
          value={d.summary.uniqueUrls}
          icon={<LinkOutlined style={{ color: BRAND }} />}
        />
      </Row>

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={12}>
          <Card title="Bot Activity">
            {loading ? (
              <Skeleton active />
            ) : (
              <LineChart
                labels={d.botTimeline.map((t) => t.date.length > 5 ? t.date.slice(5) : t.date)}
                series={[
                  { label: 'Googlebot', color: BRAND, points: d.botTimeline.map((t) => t.googlebot) },
                  { label: 'GPTBot', color: '#722ed1', points: d.botTimeline.map((t) => t.gptbot) },
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
              title: 'Cache',
              dataIndex: 'cacheHit',
              width: 100,
              render: (hit: boolean) =>
                hit ? <Tag color="green">HIT</Tag> : <Tag color="default">MISS</Tag>,
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
}: {
  loading: boolean
  title: string
  value: number
  suffix?: string
  icon: React.ReactNode
}) {
  return (
    <Col xs={12} lg={6}>
      <Card>
        {loading ? (
          <Skeleton active paragraph={false} />
        ) : (
          <Statistic title={title} value={value} suffix={suffix} prefix={icon} />
        )}
      </Card>
    </Col>
  )
}
