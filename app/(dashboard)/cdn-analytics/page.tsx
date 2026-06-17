'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Statistic,
  Select,
  DatePicker,
  Table,
  Tag,
  Typography,
  Space,
  Skeleton,
} from 'antd'
import {
  ThunderboltOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { DonutChart, Legend, BarChart, LineChart } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Title } = Typography
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
  topCrawlers: { botName: string; requests: number; percentage: number }[]
  botTypeSplit: { search: number; ai: number; social: number; unknown: number }
  topPages: { url: string; hits: number; uniqueBots: number; lastCrawled: string; cacheHit: boolean }[]
}

// Empty shape — real data comes from /api/analytics. No fake numbers.
const EMPTY: Analytics = {
  summary: {
    totalBotRequests: 0,
    uniqueUrls: 0,
    cacheHitRate: 0,
    avgResponseTime: 0,
    totalRenders: 0,
  },
  botTimeline: [],
  topCrawlers: [],
  botTypeSplit: { search: 0, ai: 0, social: 0, unknown: 0 },
  topPages: [],
}

export default function CdnAnalyticsPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<Analytics>(EMPTY)
  const [sites, setSites] = useState<{ id: string; domain: string }[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [botType, setBotType] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites ?? []))
      .catch(() => setSites([]))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (siteId) params.set('site_id', siteId)
      if (botType) params.set('bot_type', botType)
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
  }, [siteId, botType, range])

  useEffect(() => {
    load()
  }, [load])

  const split = [
    { label: 'Search', value: data.botTypeSplit.search, color: BRAND },
    { label: 'AI', value: data.botTypeSplit.ai, color: '#722ed1' },
    { label: 'Social', value: data.botTypeSplit.social, color: '#1677ff' },
    { label: 'Unknown', value: data.botTypeSplit.unknown, color: '#bfbfbf' },
  ]

  return (
    <div style={{ padding: 24 }}>
      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
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
          CDN Analytics
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="All domains"
            style={{ minWidth: 180 }}
            value={siteId}
            onChange={setSiteId}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <Select
            allowClear
            placeholder="All bot types"
            style={{ minWidth: 150 }}
            value={botType}
            onChange={setBotType}
            options={[
              { value: 'search', label: 'Search' },
              { value: 'ai', label: 'AI' },
              { value: 'social', label: 'Social' },
              { value: 'unknown', label: 'Unknown' },
            ]}
          />
          <RangePicker onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} />
        </Space>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <SummaryCard loading={loading} title="Total Bot Requests" value={data.summary.totalBotRequests} icon={<ThunderboltOutlined style={{ color: BRAND }} />} />
        <SummaryCard loading={loading} title="Unique URLs Crawled" value={data.summary.uniqueUrls} icon={<LinkOutlined style={{ color: BRAND }} />} />
        <SummaryCard loading={loading} title="Cache Hit Rate" value={data.summary.cacheHitRate} suffix="%" icon={<CheckCircleOutlined style={{ color: BRAND }} />} />
        <SummaryCard loading={loading} title="Avg Response Time" value={data.summary.avgResponseTime} suffix="ms" icon={<ClockCircleOutlined style={{ color: BRAND }} />} />
      </Row>

      {/* ── Timeline + Donut ────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={16}>
          <Card title="Bot Activity Timeline">
            {loading ? (
              <Skeleton active />
            ) : (
              <LineChart
                labels={data.botTimeline.map((t) => t.date.length > 5 ? t.date.slice(5) : t.date)}
                series={[
                  { label: 'Googlebot', color: BRAND, points: data.botTimeline.map((t) => t.googlebot) },
                  { label: 'GPTBot', color: '#722ed1', points: data.botTimeline.map((t) => t.gptbot) },
                  { label: 'Bingbot', color: '#1677ff', points: data.botTimeline.map((t) => t.bingbot) },
                  { label: 'Others', color: '#faad14', points: data.botTimeline.map((t) => t.others) },
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="AI vs Search Split">
            {loading ? (
              <Skeleton active />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <DonutChart data={split} />
                <Legend data={split} />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ── Top Crawlers ────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={12}>
          <Card title="Top Crawlers">
            {loading ? (
              <Skeleton active />
            ) : (
              <BarChart
                data={data.topCrawlers.map((c) => ({ label: c.botName, value: c.requests }))}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Crawler Breakdown">
            <Table
              loading={loading}
              rowKey="botName"
              pagination={false}
              size="small"
              dataSource={data.topCrawlers}
              columns={[
                { title: 'Bot', dataIndex: 'botName' },
                {
                  title: 'Requests',
                  dataIndex: 'requests',
                  sorter: (a, b) => a.requests - b.requests,
                  render: (v: number) => v.toLocaleString(),
                },
                {
                  title: 'Share',
                  dataIndex: 'percentage',
                  render: (v: number) => `${v}%`,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {/* ── Most Crawled Pages ──────────────────────────────────────────────── */}
      <Card title="Most Crawled Pages">
        <Table
          loading={loading}
          rowKey="url"
          dataSource={data.topPages}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          columns={[
            { title: 'URL', dataIndex: 'url', ellipsis: true },
            {
              title: 'Total Hits',
              dataIndex: 'hits',
              width: 120,
              sorter: (a, b) => a.hits - b.hits,
              render: (v: number) => v.toLocaleString(),
            },
            { title: 'Unique Bots', dataIndex: 'uniqueBots', width: 120 },
            {
              title: 'Last Crawled',
              dataIndex: 'lastCrawled',
              width: 190,
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: 'Cache Status',
              dataIndex: 'cacheHit',
              width: 130,
              render: (hit: boolean) =>
                hit ? <Tag color="green">HIT</Tag> : <Tag color="default">MISS</Tag>,
            },
          ]}
        />
      </Card>
    </div>
  )
}

function SummaryCard({
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
