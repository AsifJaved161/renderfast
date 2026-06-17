'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Card,
  Table,
  Input,
  Select,
  Switch,
  Tag,
  Tooltip,
  Typography,
  Space,
  Row,
  Col,
  DatePicker,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'

const { Title, Text } = Typography
const { RangePicker } = DatePicker
const BRAND = '#2da01d'
const LIMIT = 50
const REFRESH_MS = 10_000

interface RenderRow {
  id: string
  url: string
  domain: string
  user_email: string
  bot_name: string | null
  bot_type: 'search' | 'ai' | 'social' | 'unknown' | null
  cache_hit: boolean
  status_code: number | null
  render_time_ms: number | null
  created_at: string
}

interface Stats {
  today: number
  this_month: number
  platform_hit_rate: number
  avg_render_time: number
}

const BOT_TYPE_COLOR: Record<string, string> = {
  search: 'blue',
  ai: 'purple',
  social: 'orange',
  unknown: 'default',
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function fmtTimestamp(iso: string) {
  // YYYY-MM-DD HH:mm:ss (local)
  const d = new Date(iso)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function statusColor(code: number | null) {
  if (code == null) return '#888'
  if (code >= 500) return '#ff4d4f'
  if (code >= 400) return '#faad14'
  if (code >= 300) return '#1677ff'
  return '#52c41a'
}

function timeColor(ms: number | null) {
  if (ms == null) return '#888'
  if (ms < 500) return '#52c41a'
  if (ms < 2000) return '#faad14'
  return '#ff4d4f'
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <Card size="small" style={{ background: '#1a1a1a', borderColor: '#2a2a2a' }} bodyStyle={{ padding: '14px 18px' }}>
      <Text style={{ color: '#888', fontSize: 12 }}>{label}</Text>
      <div style={{ color: '#fff', fontSize: 26, fontWeight: 700, lineHeight: 1.2, marginTop: 4 }}>{value}</div>
    </Card>
  )
}

export default function AdminRendersPage() {
  const [rows, setRows] = useState<RenderRow[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<Stats>({ today: 0, this_month: 0, platform_hit_rate: 0, avg_render_time: 0 })
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)

  // Filters
  const [userEmail, setUserEmail] = useState('')
  const [domain, setDomain] = useState('')
  const [botType, setBotType] = useState<string | undefined>()
  const [cache, setCache] = useState<string | undefined>()
  const [range, setRange] = useState<{ start?: string; end?: string }>({})

  const [autoRefresh, setAutoRefresh] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (userEmail) params.set('user_id', userEmail) // server matches email-as-id loosely; see note
      if (domain) params.set('domain', domain)
      if (botType) params.set('bot_type', botType)
      if (cache) params.set('cache', cache)
      if (range.start) params.set('start', range.start)
      if (range.end) params.set('end', range.end)

      const res = await fetch(`/api/admin/renders?${params}`)
      if (!res.ok) throw new Error(String(res.status))
      const json = await res.json()
      setRows(json.renders ?? [])
      setTotal(json.total ?? 0)
      setStats(json.stats ?? stats)
    } catch {
      message.error('Failed to load renders')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, userEmail, domain, botType, cache, range])

  useEffect(() => {
    load()
  }, [load])

  // Auto-refresh every 10s while the switch is on.
  useEffect(() => {
    if (!autoRefresh) return
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [autoRefresh, load])

  function onEmailChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      setUserEmail(v.trim())
    }, 300)
  }

  function onDomainChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      setDomain(v.trim())
    }, 300)
  }

  const columns: ColumnsType<RenderRow> = [
    {
      title: 'Timestamp',
      dataIndex: 'created_at',
      width: 170,
      render: (v: string) => <Text style={{ fontSize: 12, color: '#bbb', fontVariantNumeric: 'tabular-nums' }}>{fmtTimestamp(v)}</Text>,
    },
    {
      title: 'User',
      dataIndex: 'user_email',
      width: 160,
      render: (email: string) => (
        <Tooltip title={email}>
          <Text style={{ fontSize: 12, color: '#ccc' }}>{truncate(email, 20)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Domain',
      dataIndex: 'domain',
      width: 150,
      render: (d: string) => <Text strong style={{ color: '#eee' }}>{d}</Text>,
    },
    {
      title: 'URL',
      dataIndex: 'url',
      render: (url: string) => (
        <Tooltip title={url}>
          <Text style={{ fontSize: 12, color: '#aaa' }}>{truncate(url, 40)}</Text>
        </Tooltip>
      ),
    },
    {
      title: 'Bot',
      key: 'bot',
      width: 170,
      render: (_, r) => (
        <Space size={6}>
          <Text style={{ fontSize: 12, color: '#ccc' }}>{r.bot_name ?? '—'}</Text>
          {r.bot_type && <Tag color={BOT_TYPE_COLOR[r.bot_type] ?? 'default'} style={{ margin: 0 }}>{r.bot_type}</Tag>}
        </Space>
      ),
    },
    {
      title: 'Cache',
      dataIndex: 'cache_hit',
      width: 80,
      render: (hit: boolean) => (hit ? <Tag color="green">HIT</Tag> : <Tag color="orange">MISS</Tag>),
    },
    {
      title: 'Status',
      dataIndex: 'status_code',
      width: 80,
      render: (code: number | null) => <Text strong style={{ color: statusColor(code) }}>{code ?? '—'}</Text>,
    },
    {
      title: 'Time',
      dataIndex: 'render_time_ms',
      width: 90,
      render: (ms: number | null) => <Text style={{ color: timeColor(ms) }}>{ms == null ? '—' : `${ms} ms`}</Text>,
    },
  ]

  return (
    <div>
      {/* keyframes for the live pulse dot */}
      <style>{`@keyframes rf-pulse {0%{box-shadow:0 0 0 0 rgba(82,196,26,0.55)}70%{box-shadow:0 0 0 7px rgba(82,196,26,0)}100%{box-shadow:0 0 0 0 rgba(82,196,26,0)}}`}</style>

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <Title level={3} style={{ color: '#fff', margin: 0 }}>
          Renders Monitor
        </Title>
        <Space size={12}>
          {autoRefresh && (
            <Space size={6}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: '#52c41a',
                  animation: 'rf-pulse 1.6s infinite',
                }}
              />
              <Text style={{ color: '#52c41a', fontSize: 12 }}>Live</Text>
            </Space>
          )}
          <Text style={{ color: '#888', fontSize: 13 }}>Auto-refresh</Text>
          <Switch checked={autoRefresh} onChange={setAutoRefresh} />
        </Space>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatCard label="Renders Today" value={stats.today.toLocaleString()} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard label="Renders This Month" value={stats.this_month.toLocaleString()} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard label="Platform Cache Hit Rate" value={`${stats.platform_hit_rate}%`} />
        </Col>
        <Col xs={12} md={6}>
          <StatCard label="Avg Render Time" value={`${stats.avg_render_time} ms`} />
        </Col>
      </Row>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            placeholder="User email / id"
            allowClear
            onChange={(e) => onEmailChange(e.target.value)}
            style={{ width: 220 }}
          />
          <Input placeholder="Domain" allowClear onChange={(e) => onDomainChange(e.target.value)} style={{ width: 180 }} />
          <Select
            allowClear
            placeholder="All bots"
            style={{ width: 150 }}
            value={botType}
            onChange={(v) => {
              setPage(1)
              setBotType(v)
            }}
            options={[
              { value: 'googlebot', label: 'Googlebot' },
              { value: 'gptbot', label: 'GPTBot' },
              { value: 'bingbot', label: 'Bingbot' },
              { value: 'others', label: 'Others' },
            ]}
          />
          <Select
            allowClear
            placeholder="All cache"
            style={{ width: 150 }}
            value={cache}
            onChange={(v) => {
              setPage(1)
              setCache(v)
            }}
            options={[
              { value: 'hit', label: 'Cache HIT' },
              { value: 'miss', label: 'Cache MISS' },
            ]}
          />
          <RangePicker
            onChange={(_, strs) => {
              setPage(1)
              if (strs && strs[0] && strs[1]) {
                setRange({ start: `${strs[0]}T00:00:00`, end: `${strs[1]}T23:59:59` })
              } else {
                setRange({})
              }
            }}
          />
        </Space>
      </Card>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <Card size="small">
        <Table<RenderRow>
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={{
            current: page,
            pageSize: LIMIT,
            total,
            showSizeChanger: false,
            showTotal: (t) => `${t.toLocaleString()} renders`,
            onChange: setPage,
          }}
          scroll={{ x: 'max-content' }}
        />
      </Card>
    </div>
  )
}
