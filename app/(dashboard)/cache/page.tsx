'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Statistic,
  Button,
  Select,
  Table,
  Tag,
  Tooltip,
  Popconfirm,
  Modal,
  Space,
  Typography,
  message,
} from 'antd'
import {
  ReloadOutlined,
  DeleteOutlined,
  EyeOutlined,
  DatabaseOutlined,
  HddOutlined,
  CheckCircleOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Paragraph } = Typography

interface CacheEntry {
  id: string
  url: string
  status_code: number | null
  html_size_bytes: number | null
  render_time_ms: number | null
  cached_at: string
  expires_at: string | null
}

function statusColor(code: number | null) {
  if (!code) return 'default'
  if (code >= 200 && code < 300) return 'green'
  if (code >= 300 && code < 400) return 'orange'
  return 'red'
}

export default function CachePage() {
  const [loading, setLoading] = useState(true)
  const { sites } = useDashboard() // shared from the layout — no extra /api/sites call
  const [rows, setRows] = useState<CacheEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [siteId, setSiteId] = useState<string | undefined>()
  const [selected, setSelected] = useState<React.Key[]>([])
  const [busy, setBusy] = useState(false)
  const [viewHtml, setViewHtml] = useState<{ url: string; html: string } | null>(null)
  const [summary, setSummary] = useState({ total: 0, totalSizeBytes: 0, avgTtlHours: 0, hitRate: 0 })
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (siteId) params.set('site_id', siteId)
      const sumParams = new URLSearchParams({ summary: 'true' })
      if (siteId) sumParams.set('site_id', siteId)

      const [list, sum] = await Promise.all([
        fetch(`/api/cache?${params}`).then((r) => r.json()),
        fetch(`/api/cache?${sumParams}`).then((r) => r.json()),
      ])
      setRows(list.data ?? [])
      setTotal(list.total ?? 0)
      if (sum.summary) setSummary(sum.summary)
    } catch {
      message.error('Failed to load cache')
    } finally {
      setLoading(false)
    }
  }, [page, siteId])

  useEffect(() => {
    load()
  }, [load])

  // ── Real aggregate stats (whole cache, not just this page) ─────────────────
  const totalSizeKb = summary.totalSizeBytes / 1024
  const hitRate = summary.hitRate
  const avgTtl = summary.avgTtlHours

  async function refreshOne(url: string) {
    setBusy(true)
    try {
      const res = await fetch('/api/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, site_id: siteId }),
      })
      if (res.ok) message.success('Re-rendered')
      else message.error('Refresh failed')
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function refreshAll() {
    setBusy(true)
    const hide = message.loading('Refreshing all cached pages…', 0)
    try {
      for (const r of rows) {
        await fetch('/api/cache', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: r.url, site_id: siteId }),
        })
      }
      message.success('All pages refreshed')
      await load()
    } finally {
      hide()
      setBusy(false)
    }
  }

  async function deleteOne(url: string) {
    await fetch(`/api/cache?url=${encodeURIComponent(url)}`, { method: 'DELETE' })
    message.success('Deleted')
    await load()
  }

  async function deleteSelected() {
    setBusy(true)
    try {
      const urls = rows.filter((r) => selected.includes(r.id)).map((r) => r.url)
      for (const url of urls) {
        await fetch(`/api/cache?url=${encodeURIComponent(url)}`, { method: 'DELETE' })
      }
      message.success(`Deleted ${urls.length} entries`)
      setSelected([])
      await load()
    } finally {
      setBusy(false)
    }
  }

  async function clearAll() {
    if (!siteId) {
      message.warning('Select a site to clear its cache')
      return
    }
    await fetch(`/api/cache?action=clear-all&site_id=${siteId}`, { method: 'DELETE' })
    message.success('Cache cleared')
    await load()
  }

  async function openHtml(url: string) {
    const hide = message.loading('Fetching HTML…', 0)
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })
      const html = await res.text()
      setViewHtml({ url, html })
    } finally {
      hide()
    }
  }

  return (
    <div style={{ padding: 24 }}>
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
          Cache Manager
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="All sites"
            style={{ minWidth: 200 }}
            value={siteId}
            onChange={(v) => {
              setSiteId(v)
              setPage(1)
            }}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <Button icon={<ReloadOutlined />} loading={busy} onClick={refreshAll}>
            Refresh All
          </Button>
          <Popconfirm
            title="Clear all cache for this site?"
            description="This permanently removes all cached pages."
            onConfirm={clearAll}
            okText="Clear"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />}>
              Clear All Cache
            </Button>
          </Popconfirm>
        </Space>
      </div>

      {/* ── Stat cards ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Pages stored in cache, ready to serve bots instantly.">Total Cached Pages</StatTitle>} value={total} prefix={<DatabaseOutlined style={{ color: BRAND }} />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            {totalSizeKb >= 1024 ? (
              <Statistic title={<StatTitle hint="Total storage used by your cached pages.">Total Size</StatTitle>} value={totalSizeKb / 1024} precision={2} suffix="MB" prefix={<HddOutlined style={{ color: BRAND }} />} />
            ) : (
              <Statistic title={<StatTitle hint="Total storage used by your cached pages.">Total Size</StatTitle>} value={totalSizeKb} precision={1} suffix="KB" prefix={<HddOutlined style={{ color: BRAND }} />} />
            )}
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Share of bot requests served straight from cache (no render needed).">Cache Hit Rate</StatTitle>} value={hitRate} suffix="%" prefix={<CheckCircleOutlined style={{ color: BRAND }} />} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Average time a cached page stays fresh before it is re-rendered.">Avg TTL</StatTitle>} value={avgTtl} precision={1} suffix="h" prefix={<FieldTimeOutlined style={{ color: BRAND }} />} />
          </Card>
        </Col>
      </Row>

      {/* ── Bulk actions bar ────────────────────────────────────────────────── */}
      {selected.length > 0 && (
        <Card size="small" style={{ marginBottom: 12, background: '#f6ffed', borderColor: BRAND }}>
          <Space>
            <span>{selected.length} selected</span>
            <Popconfirm title="Delete selected entries?" onConfirm={deleteSelected}>
              <Button danger size="small" icon={<DeleteOutlined />}>
                Delete Selected
              </Button>
            </Popconfirm>
          </Space>
        </Card>
      )}

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <Card>
        <Table<CacheEntry>
          loading={loading}
          rowKey="id"
          dataSource={rows}
          rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
          pagination={{
            current: page,
            pageSize: LIMIT,
            total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            {
              title: 'URL',
              dataIndex: 'url',
              ellipsis: true,
              render: (url: string) => (
                <Tooltip title={url}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {url}
                  </a>
                </Tooltip>
              ),
            },
            {
              title: <StatTitle hint="HTTP status of the cached page (200 = OK).">Status</StatTitle>,
              dataIndex: 'status_code',
              width: 110,
              render: (code: number | null) => <Tag color={statusColor(code)}>{code ?? '—'}</Tag>,
            },
            {
              title: <StatTitle hint="When this page was rendered & stored in cache.">Cached At</StatTitle>,
              dataIndex: 'cached_at',
              width: 180,
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: <StatTitle hint="Next time we check the origin for changes — the page is only re-rendered if its content actually changed.">Expires At</StatTitle>,
              dataIndex: 'expires_at',
              width: 180,
              render: (v: string | null) => (v ? new Date(v).toLocaleString() : '—'),
            },
            {
              title: <StatTitle hint="Size of the cached HTML page.">Size</StatTitle>,
              dataIndex: 'html_size_bytes',
              width: 110,
              render: (b: number | null) => (b ? `${(b / 1024).toFixed(1)} KB` : '—'),
            },
            {
              title: <StatTitle hint="One-time time it took to render this page (background — not what bots wait for).">Render</StatTitle>,
              dataIndex: 'render_time_ms',
              width: 110,
              render: (v: number | null) => (v ? `${v} ms` : '—'),
            },
            {
              title: <StatTitle hint="Re-render, view the cached HTML, or delete this entry.">Actions</StatTitle>,
              width: 130,
              render: (_, row) => (
                <Space>
                  <Tooltip title="Refresh">
                    <Button size="small" icon={<ReloadOutlined />} onClick={() => refreshOne(row.url)} />
                  </Tooltip>
                  <Tooltip title="View HTML">
                    <Button size="small" icon={<EyeOutlined />} onClick={() => openHtml(row.url)} />
                  </Tooltip>
                  <Popconfirm title="Delete this entry?" onConfirm={() => deleteOne(row.url)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* ── View HTML modal ─────────────────────────────────────────────────── */}
      <Modal
        open={!!viewHtml}
        title={viewHtml?.url}
        onCancel={() => setViewHtml(null)}
        footer={null}
        width={900}
      >
        <Paragraph>
          <pre
            style={{
              maxHeight: '60vh',
              overflow: 'auto',
              background: '#16213e',
              color: '#e6e6e6',
              padding: 16,
              borderRadius: 8,
              fontSize: 12,
            }}
          >
            <code>{viewHtml?.html}</code>
          </pre>
        </Paragraph>
      </Modal>
    </div>
  )
}
