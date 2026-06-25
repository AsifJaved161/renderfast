'use client'

import { useState } from 'react'
import useSWR from 'swr'
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
  Alert,
  Tooltip,
} from 'antd'
import Link from 'next/link'
import {
  ThunderboltOutlined,
  LinkOutlined,
  CheckCircleOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { DonutChart, Legend, BarChart, MetricTilesChart } from '@/components/charts/Charts'
import { StatTitle } from '@/components/ui/StatTitle'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title } = Typography
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
    avgCacheServeTime: 0,
    avgRenderTime: 0,
    totalRenders: 0,
  },
  botTimeline: [],
  topCrawlers: [],
  botTypeSplit: { search: 0, ai: 0, social: 0, unknown: 0 },
  topPages: [],
}

export default function CdnAnalyticsPage() {
  const { sites } = useDashboard() // shared from the layout — no extra /api/sites call
  const [siteId, setSiteId] = useState<string | undefined>()
  const [botType, setBotType] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)

  // Analytics via SWR — cached per site/bot/date-range key, so returning to a
  // previously-seen view renders instantly and revalidates in the background.
  const params = new URLSearchParams()
  if (siteId) params.set('site_id', siteId)
  if (botType) params.set('bot_type', botType)
  if (range) {
    params.set('start_date', range[0].toISOString())
    params.set('end_date', range[1].toISOString())
  }
  const { data: raw, isLoading: loading } = useSWR<Analytics>(
    `/api/analytics?${params.toString()}`
  )
  const data = raw?.summary ? raw : EMPTY

  const split = [
    { label: 'Search', value: data.botTypeSplit.search, color: BRAND },
    { label: 'AI', value: data.botTypeSplit.ai, color: '#722ed1' },
    { label: 'Social', value: data.botTypeSplit.social, color: '#1677ff' },
    { label: 'Unknown', value: data.botTypeSplit.unknown, color: '#bfbfbf' },
  ]

  const hasActivity = data.summary.totalBotRequests > 0 || data.summary.totalRenders > 0

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

      {/* ── Empty state ─────────────────────────────────────────────────────── */}
      {!loading && !hasActivity && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 20 }}
          message="No crawler activity yet"
          description={
            <span>
              Once a domain is integrated and search / AI crawlers start hitting it, their
              requests, cache hits and most-crawled pages appear here.{' '}
              <Link href="/integration-wizard" style={{ color: BRAND, fontWeight: 600 }}>
                Open the Integration Wizard →
              </Link>
            </span>
          }
        />
      )}

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <SummaryCard loading={loading} title="Total Bot Requests" value={data.summary.totalBotRequests} icon={<ThunderboltOutlined style={{ color: BRAND }} />} tooltip="Times search & AI crawlers hit your integrated domains." />
        <SummaryCard loading={loading} title="Unique URLs Crawled" value={data.summary.uniqueUrls} icon={<LinkOutlined style={{ color: BRAND }} />} tooltip="Distinct pages crawled by bots." />
        <SummaryCard loading={loading} title="Cache Hit Rate" value={data.summary.cacheHitRate} suffix="%" icon={<CheckCircleOutlined style={{ color: BRAND }} />} tooltip="Share of bot requests served instantly from cache (no render)." />
        <SummaryCard loading={loading} title="Cache Response Time" value={data.summary.avgCacheServeTime > 0 ? data.summary.avgCacheServeTime : '—'} suffix={data.summary.avgCacheServeTime > 0 ? 'ms' : undefined} icon={<ThunderboltOutlined style={{ color: BRAND }} />} tooltip="How fast crawlers receive your rendered pages from cache. Instant serving means faster, fuller indexing of your site. Background render time is separate." />
      </Row>

      {/* ── Timeline + Donut ────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={16}>
          <Card title="Bot Activity Timeline">
            {loading ? (
              <Skeleton active />
            ) : (
              <MetricTilesChart
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
            {
              title: 'URL',
              dataIndex: 'url',
              ellipsis: true,
              render: (u: string) => (
                <a href={u} target="_blank" rel="noopener noreferrer">
                  {u}
                </a>
              ),
            },
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
              title: (
                <StatTitle hint="HIT = served instantly from cache. MISS = wasn't cached yet, so it was rendered fresh this time. The first hit of any page is always a MISS — the next one becomes a HIT.">
                  Cache Status
                </StatTitle>
              ),
              dataIndex: 'cacheHit',
              width: 130,
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
