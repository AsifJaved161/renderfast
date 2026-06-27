'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
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
  Segmented,
} from 'antd'
import {
  ThunderboltOutlined,
  CheckCircleOutlined,
  ThunderboltFilled,
  LinkOutlined,
  InfoCircleOutlined,
  WarningOutlined,
  HddOutlined,
} from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { DonutChart, Legend, BarChart, LineChart, MetricTilesChart } from '@/components/charts/Charts'
import { StatTitle } from '@/components/ui/StatTitle'
import { BotCostWidget } from '@/components/dashboard/BotCostWidget'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text } = Typography
const { RangePicker } = DatePicker

// HTTP status-class colours (shared by the two status charts).
const STATUS_COLOR: Record<string, string> = {
  '2xx': '#2da01d',
  '3xx': '#1677ff',
  '4xx': '#faad14',
  '5xx': '#ff4d4f',
  other: '#bfbfbf',
}

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
  statusSplit: { code: string; hits: number }[]
  responseByStatus: { code: string; avgMs: number }[]
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
  statusSplit: [],
  responseByStatus: [],
  usageStats: {
    renderCount: 0,
    renderLimit: 0,
    percentUsed: 0,
    resetAt: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  },
}

// Keep the Renders Trend bar chart readable over ANY range: show daily bars for
// short spans, then automatically roll up to weekly, then monthly, so a full
// year renders as ~12 bars instead of 365. Buckets sum the daily render counts.
function bucketRenderTrend(trend: { date: string; renders: number }[]): {
  granularity: 'Daily' | 'Weekly' | 'Monthly'
  data: { label: string; value: number }[]
} {
  if (trend.length <= 31) {
    return { granularity: 'Daily', data: trend.map((t) => ({ label: t.date.slice(5), value: t.renders })) }
  }
  const monthly = trend.length > 140
  const buckets = new Map<string, number>()
  for (const t of trend) {
    let key: string
    if (monthly) {
      key = t.date.slice(0, 7) // YYYY-MM
    } else {
      // Roll up to the week's Monday (UTC) so weeks group consistently.
      const d = new Date(t.date + 'T00:00:00Z')
      const dow = d.getUTCDay() || 7 // Mon=1 … Sun=7
      d.setUTCDate(d.getUTCDate() - (dow - 1))
      key = d.toISOString().slice(0, 10)
    }
    buckets.set(key, (buckets.get(key) ?? 0) + t.renders)
  }
  const data = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ label: monthly ? key : key.slice(5), value }))
  return { granularity: monthly ? 'Monthly' : 'Weekly', data }
}

export default function DashboardPage() {
  const { sites, user } = useDashboard() // shared from the layout — no extra calls
  const [siteId, setSiteId] = useState<string | undefined>()
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const plan: string = user?.plan ?? 'free'
  // Locale/timezone date formatting only runs after mount so the server-rendered
  // HTML and the client's first render stay identical (no hydration mismatch).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // First-time users (no sites yet) → guide them through the onboarding wizard.
  // Explicit fetch (not context) so there's no "still loading" race, and a
  // localStorage flag means we never trap a returning user in a redirect loop.
  const router = useRouter()
  useEffect(() => {
    try {
      if (localStorage.getItem('rf_onboarded')) return
    } catch {
      return
    }
    fetch('/api/sites')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if ((d.sites ?? []).length === 0) router.push('/onboarding')
        else {
          try {
            localStorage.setItem('rf_onboarded', '1')
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})
  }, [router])

  // Analytics via SWR — cached per site/date-range key in a global store, so
  // switching back to a previously-seen view renders instantly (no skeleton)
  // and revalidates in the background. The key is just the request URL.
  const params = new URLSearchParams()
  if (siteId) params.set('site_id', siteId)
  if (range) {
    params.set('start_date', range[0].toISOString())
    params.set('end_date', range[1].toISOString())
  }
  const { data: raw, isLoading: loading } = useSWR<Analytics>(
    `/api/analytics?${params.toString()}`
  )

  // Bot Activity chart has its own independent date filter.
  const BOT_RANGE_DAYS: Record<string, number | null> = { '7d': 7, '30d': 30, '6m': 180, '1y': 365, 'All': null }
  const [botRange, setBotRange] = useState('30d')
  const botParams = new URLSearchParams()
  if (siteId) botParams.set('site_id', siteId)
  const botDaysNum = BOT_RANGE_DAYS[botRange]
  botParams.set('start_date', botDaysNum !== null
    ? new Date(Date.now() - botDaysNum * 86400_000).toISOString()
    : '2020-01-01T00:00:00.000Z'
  )
  const { data: botRaw } = useSWR<Analytics>(`/api/analytics?${botParams.toString()}`)

  // Cache size — separate call so it reacts to site filter without touching analytics.
  const cacheParams = new URLSearchParams({ summary: 'true' })
  if (siteId) cacheParams.set('site_id', siteId)
  const { data: cacheSumData } = useSWR<{ summary: { totalSizeBytes: number } }>(`/api/cache?${cacheParams}`)
  const totalSizeKb = (cacheSumData?.summary?.totalSizeBytes ?? 0) / 1024

  const d = raw?.summary ? raw : EMPTY
  // Use botRaw when available (user changed filter); fall back to main fetch's
  // botTimeline so the chart is never blank while the separate SWR is loading.
  const botTimeline = botRaw?.botTimeline ?? d.botTimeline ?? []
  const hasActivity = d.summary.totalRenders > 0 || d.summary.totalBotRequests > 0
  // The cost widget is per-site; fall back to the first site when "All sites".
  const costSiteId = siteId ?? sites[0]?.id
  // Adaptive trend (daily → weekly → monthly) so long ranges stay readable.
  const renderTrendChart = bucketRenderTrend(d.renderTrend)

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
              <StatTitle hint="Your plan includes a monthly render allowance. Each fresh prerender of a page counts as one render (cache hits don't). This resets every month.">
                <Text strong style={{ fontSize: 16 }}>
                  {d.usageStats.renderCount.toLocaleString()} of{' '}
                  {d.usageStats.renderLimit.toLocaleString()} renders used this month
                </Text>
              </StatTitle>
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
          lgSpan={5}
          title="Total Bot Requests"
          value={d.summary.totalBotRequests}
          icon={<ThunderboltOutlined style={{ color: BRAND }} />}
          tooltip="How many times search & AI crawlers (Googlebot, GPTBot, etc.) hit your integrated domains."
        />
        <StatCard
          loading={loading}
          lgSpan={5}
          title="Cache Hit Rate"
          value={d.summary.cacheHitRate}
          suffix="%"
          icon={<CheckCircleOutlined style={{ color: BRAND }} />}
          tooltip="Share of bot requests served instantly from cache — no fresh render needed. Higher is better; it climbs as your pages get cached."
        />
        <StatCard
          loading={loading}
          lgSpan={5}
          title="Cache Response Time"
          value={d.summary.avgCacheServeTime > 0 ? d.summary.avgCacheServeTime : '—'}
          suffix={d.summary.avgCacheServeTime > 0 ? 'ms' : undefined}
          icon={<ThunderboltFilled style={{ color: BRAND }} />}
          tooltip="How fast crawlers receive your fully-rendered pages from cache. Instant serving helps Google & AI bots index your site faster. The one-time background render doesn't affect this."
        />
        <StatCard
          loading={loading}
          lgSpan={5}
          title="Unique URLs"
          value={d.summary.uniqueUrls}
          icon={<LinkOutlined style={{ color: BRAND }} />}
          tooltip="Number of distinct pages crawled by bots on your domains."
        />
        <Col xs={12} lg={4}>
          <Card>
            {loading ? (
              <Skeleton active paragraph={false} />
            ) : (
              <Statistic
                title={<StatTitle hint="Total storage used by all your cached pages. Visit Cache Manager for more details.">Total Cache Size</StatTitle>}
                value={totalSizeKb >= 1024 ? +(totalSizeKb / 1024).toFixed(2) : +totalSizeKb.toFixed(1)}
                precision={totalSizeKb >= 1024 ? 2 : 1}
                suffix={totalSizeKb >= 1024 ? 'MB' : 'KB'}
                prefix={<HddOutlined style={{ color: BRAND }} />}
              />
            )}
          </Card>
        </Col>
      </Row>

      {/* ── Bots Served from Cache ──────────────────────────────────────────── */}
      {(() => {
        const totalCacheHits = d.renderTrend.reduce((s, t) => s + (t.cacheHits ?? 0), 0)
        const rate = d.summary.cacheHitRate / 100
        const breakdown = [
          { label: 'Search Engines', value: Math.round(d.botTypeSplit.search * rate), color: BRAND },
          { label: 'AI Crawlers',    value: Math.round(d.botTypeSplit.ai * rate),     color: '#722ed1' },
          { label: 'Social Bots',    value: Math.round(d.botTypeSplit.social * rate),  color: '#1677ff' },
          { label: 'Others',         value: Math.round(d.botTypeSplit.unknown * rate), color: '#bfbfbf' },
        ]
        return (
          <Card style={{ marginBottom: 20, borderColor: BRAND, background: 'linear-gradient(135deg,#f6ffed 0%,#ffffff 100%)' }}>
            {loading ? (
              <Skeleton active paragraph={{ rows: 2 }} />
            ) : (
              <Row gutter={[32, 16]} align="middle">
                <Col xs={24} sm={10}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                    <ThunderboltFilled style={{ fontSize: 32, color: BRAND }} />
                    <div>
                      <div style={{ fontSize: 36, fontWeight: 700, color: BRAND, lineHeight: 1.1 }}>
                        {totalCacheHits.toLocaleString()}
                      </div>
                      <StatTitle hint="Total bot requests served directly from cache — no fresh render was needed. Each one saves bandwidth and reduces origin load.">
                        <Text style={{ fontSize: 14, color: '#374151' }}>Bots Served from Cache</Text>
                      </StatTitle>
                    </div>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {d.summary.cacheHitRate}% of all bot traffic · {Math.max(0, d.summary.totalBotRequests - totalCacheHits).toLocaleString()} fresh renders
                  </Text>
                </Col>
                <Col xs={24} sm={14}>
                  {breakdown.map((b) => (
                    <div key={b.label} style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <Text style={{ fontSize: 13 }}>{b.label}</Text>
                        <Text strong style={{ fontSize: 13 }}>{b.value.toLocaleString()}</Text>
                      </div>
                      <Progress
                        percent={totalCacheHits > 0 ? Math.round((b.value / totalCacheHits) * 100) : 0}
                        strokeColor={b.color}
                        showInfo={false}
                        size="small"
                      />
                    </div>
                  ))}
                </Col>
              </Row>
            )}
          </Card>
        )
      })()}

      {/* ── Charts row ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={24} lg={12}>
          <Card title={<StatTitle hint="How many times each crawler (Googlebot, GPTBot, Bingbot & others) hit your site per day. Tap a coloured tile to show/hide that line.">Bot Activity</StatTitle>}>
            {loading ? (
              <Skeleton active />
            ) : (
              <>
                <MetricTilesChart
                  labels={botTimeline.map((t) => t.date.length > 5 ? t.date.slice(5) : t.date)}
                  series={[
                    { label: 'Googlebot', color: BRAND, points: botTimeline.map((t) => t.googlebot) },
                    { label: 'GPTBot', color: '#722ed1', points: botTimeline.map((t) => t.gptbot) },
                    { label: 'Bingbot', color: '#1677ff', points: botTimeline.map((t) => t.bingbot) },
                    { label: 'Others', color: '#faad14', points: botTimeline.map((t) => t.others) },
                  ]}
                />
                <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
                  <Segmented
                    size="small"
                    value={botRange}
                    onChange={(v) => setBotRange(v as string)}
                    options={['7d', '30d', '6m', '1y', 'All']}
                  />
                </div>
              </>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={6}>
          <Card title={<StatTitle hint="Split of bot traffic by type — AI crawlers (GPTBot, ClaudeBot…) vs search engines (Google, Bing…) vs social link-preview bots.">AI vs Search</StatTitle>}>
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
          <Card title={<StatTitle hint="Share of bot requests served from cache (no re-render needed). Higher is better — means bots get instant responses.">Cache Hit Rate</StatTitle>}>
            {loading ? (
              <Skeleton active />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                <DonutChart
                  data={[
                    { label: 'Cache Hit', value: d.summary.cacheHitRate, color: BRAND },
                    { label: 'Cache Miss', value: Math.max(0, 100 - d.summary.cacheHitRate), color: '#f0f0f0' },
                  ]}
                  centerLabel={`${d.summary.cacheHitRate}%`}
                  centerSub="Hit Rate"
                />
                <Legend
                  data={[
                    { label: 'Cache Hit', value: d.summary.cacheHitRate, color: BRAND },
                    { label: 'Cache Miss', value: Math.max(0, 100 - d.summary.cacheHitRate), color: '#d9d9d9' },
                  ]}
                />
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {/* ── HTTP status charts ──────────────────────────────────────────────── */}
      {(d.statusSplit.length > 0 || loading) && (
        <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
          <Col xs={24} lg={12}>
            <Card title={<StatTitle hint="Breakdown of render responses by HTTP status class. Mostly 2xx is healthy; many 4xx/5xx means pages are failing for bots.">Hits by HTTP Status</StatTitle>}>
              {loading ? (
                <Skeleton active />
              ) : (() => {
                const totalHits = d.statusSplit.reduce((s, r) => s + r.hits, 0)
                const errorHits = d.statusSplit
                  .filter((s) => s.code === '4xx' || s.code === '5xx')
                  .reduce((s, r) => s + r.hits, 0)
                const errorRate = totalHits > 0 ? Math.round((errorHits / totalHits) * 100) : 0
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                    <DonutChart
                      data={d.statusSplit.map((s) => ({ label: s.code, value: s.hits, color: STATUS_COLOR[s.code] ?? '#bfbfbf' }))}
                      centerLabel={totalHits.toLocaleString()}
                      centerSub="total hits"
                    />
                    <Legend data={d.statusSplit.map((s) => ({ label: s.code, value: s.hits, color: STATUS_COLOR[s.code] ?? '#bfbfbf' }))} />
                    {errorRate > 0 ? (
                      <div style={{
                        background: errorRate > 10 ? '#fff1f0' : '#fffbe6',
                        border: `1px solid ${errorRate > 10 ? '#ffa39e' : '#ffe58f'}`,
                        borderRadius: 6,
                        padding: '6px 14px',
                        fontSize: 13,
                        color: errorRate > 10 ? '#a8071a' : '#874d00',
                        width: '100%',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}>
                        <WarningOutlined />
                        {errorRate}% error rate — {errorHits.toLocaleString()} failed {errorHits === 1 ? 'request' : 'requests'} (4xx/5xx)
                      </div>
                    ) : totalHits > 0 ? (
                      <div style={{
                        background: '#f6ffed',
                        border: '1px solid #b7eb8f',
                        borderRadius: 6,
                        padding: '6px 14px',
                        fontSize: 13,
                        color: '#135200',
                        width: '100%',
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                      }}>
                        <CheckCircleOutlined />
                        All {totalHits.toLocaleString()} requests succeeded — no errors
                      </div>
                    ) : null}
                  </div>
                )
              })()}
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card title={<StatTitle hint="Average render time per HTTP status class. Green = fast (&lt;1s), amber = needs work (1–3s), red = slow (&gt;3s).">Response Time by Status</StatTitle>}>
              {loading ? (
                <Skeleton active />
              ) : (() => {
                const avg2xx = d.responseByStatus.find((s) => s.code === '2xx')?.avgMs ?? 0
                const perfBadge =
                  avg2xx === 0 ? null
                  : avg2xx < 1000 ? { label: 'Fast', color: '#135200', bg: '#f6ffed', border: '#b7eb8f', icon: <CheckCircleOutlined /> }
                  : avg2xx < 3000 ? { label: 'Needs Work', color: '#874d00', bg: '#fffbe6', border: '#ffe58f', icon: <WarningOutlined /> }
                  : { label: 'Slow', color: '#a8071a', bg: '#fff1f0', border: '#ffa39e', icon: <WarningOutlined /> }
                return (
                  <>
                    <BarChart
                      data={d.responseByStatus.map((s) => ({ label: s.code, value: s.avgMs }))}
                      colors={d.responseByStatus.map((s) =>
                        s.avgMs < 1000 ? '#2da01d' : s.avgMs < 3000 ? '#faad14' : '#ff4d4f'
                      )}
                      formatValue={(ms) => ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`}
                    />
                    <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center', gap: 20, fontSize: 12, color: '#9ca3af' }}>
                      <span><span style={{ color: '#2da01d', fontWeight: 700 }}>●</span> &lt;1s Fast</span>
                      <span><span style={{ color: '#faad14', fontWeight: 700 }}>●</span> 1–3s Needs Work</span>
                      <span><span style={{ color: '#ff4d4f', fontWeight: 700 }}>●</span> &gt;3s Slow</span>
                    </div>
                    {perfBadge && (
                      <div style={{
                        marginTop: 10,
                        background: perfBadge.bg,
                        border: `1px solid ${perfBadge.border}`,
                        borderRadius: 6,
                        padding: '6px 14px',
                        fontSize: 13,
                        color: perfBadge.color,
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 6,
                        fontWeight: 600,
                      }}>
                        {perfBadge.icon}
                        2xx avg: {avg2xx >= 1000 ? `${(avg2xx / 1000).toFixed(1)}s` : `${avg2xx}ms`} — {perfBadge.label}
                      </div>
                    )}
                  </>
                )
              })()}
            </Card>
          </Col>
        </Row>
      )}

      {/* ── Bot cost glance (links to full Bot Cost Insights) ───────────────── */}
      <div style={{ marginBottom: 20 }}>
        <BotCostWidget siteId={costSiteId} />
      </div>

      {/* ── Top pages table ─────────────────────────────────────────────────── */}
      <Card title={<StatTitle hint="Your most-crawled pages — total bot hits, how many distinct bots visited, whether the latest hit was served from cache, and when it was last crawled.">Top Pages</StatTitle>}>
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
  lgSpan = 6,
}: {
  loading: boolean
  title: string
  value: number | string
  suffix?: string
  icon: React.ReactNode
  tooltip?: string
  lgSpan?: number
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
    <Col xs={12} lg={lgSpan}>
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
