'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Select,
  DatePicker,
  Button,
  Tag,
  Badge,
  Modal,
  Space,
  Tooltip,
  Empty,
  Typography,
  Descriptions,
  message,
} from 'antd'
import { DownloadOutlined, CodeOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Paragraph } = Typography
const { RangePicker } = DatePicker

interface HistoryRow {
  timestamp: string
  url: string
  botName: string | null
  botType: string | null
  cacheHit: boolean
  statusCode: number | null
  responseTime: number | null
  userAgent: string | null
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function statusColor(code: number | null) {
  if (!code) return 'default'
  if (code >= 200 && code < 300) return 'green'
  if (code >= 300 && code < 400) return 'orange'
  return 'red'
}

const botTypeColor: Record<string, string> = {
  search: 'green',
  ai: 'purple',
  social: 'blue',
  unknown: 'default',
}

export default function RenderHistoryPage() {
  const { sites } = useDashboard() // shared from the layout — no extra /api/sites call
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<HistoryRow[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [botType, setBotType] = useState<string | undefined>()
  const [cache, setCache] = useState<'all' | 'hit' | 'miss'>('all')
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null)
  const [previewHtml, setPreviewHtml] = useState<{ url: string; html: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ type: 'history', limit: '200' })
      if (siteId) params.set('site_id', siteId)
      if (botType) params.set('bot_type', botType)
      if (range) {
        params.set('start_date', range[0].toISOString())
        params.set('end_date', range[1].toISOString())
      }
      const res = await fetch(`/api/analytics?${params}`)
      const json = await res.json()
      setRows(json.renderHistory ?? [])
    } catch {
      message.error('Failed to load history')
    } finally {
      setLoading(false)
    }
  }, [siteId, botType, range])

  useEffect(() => {
    load()
  }, [load])

  // Client-side cache filter.
  const filtered = rows.filter((r) => {
    if (cache === 'hit') return r.cacheHit
    if (cache === 'miss') return !r.cacheHit
    return true
  })

  async function openPreview(url: string) {
    const hide = message.loading('Fetching HTML…', 0)
    try {
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })
      setPreviewHtml({ url, html: await res.text() })
    } finally {
      hide()
    }
  }

  function exportCsv() {
    const header = ['Timestamp', 'URL', 'Bot Name', 'Bot Type', 'Cache', 'Status', 'Response Time', 'User Agent']
    const lines = filtered.map((r) =>
      [
        r.timestamp,
        r.url,
        r.botName ?? '',
        r.botType ?? '',
        r.cacheHit ? 'HIT' : 'MISS',
        r.statusCode ?? '',
        r.responseTime ?? '',
        r.userAgent ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `render-history-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
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
          Render History
        </Title>
        <Button icon={<DownloadOutlined />} onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="All domains"
            style={{ minWidth: 180 }}
            value={siteId}
            onChange={setSiteId}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <RangePicker onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)} />
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
          <Select
            style={{ minWidth: 130 }}
            value={cache}
            onChange={setCache}
            options={[
              { value: 'all', label: 'All cache' },
              { value: 'hit', label: 'Cache Hit' },
              { value: 'miss', label: 'Cache Miss' },
            ]}
          />
        </Space>
      </Card>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <Card>
        <Table<HistoryRow>
          loading={loading}
          rowKey={(r) => r.timestamp + r.url}
          dataSource={filtered}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{
            emptyText: (
              <Empty description="No renders yet — once crawlers hit your integrated domains, each render is logged here." />
            ),
          }}
          expandable={{
            expandedRowRender: (r) => (
              <div style={{ padding: 8 }}>
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="Full URL">{r.url}</Descriptions.Item>
                  <Descriptions.Item label="User Agent">{r.userAgent ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Bot Name">{r.botName ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Status Code">{r.statusCode ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="Response Time">
                    {r.responseTime != null ? `${r.responseTime} ms` : '—'}
                  </Descriptions.Item>
                </Descriptions>
                <Button
                  icon={<CodeOutlined />}
                  style={{ marginTop: 12 }}
                  onClick={() => openPreview(r.url)}
                >
                  HTML Preview
                </Button>
              </div>
            ),
          }}
          columns={[
            {
              title: 'Timestamp',
              dataIndex: 'timestamp',
              width: 130,
              render: (v: string) => (
                <Tooltip title={new Date(v).toLocaleString()}>{relativeTime(v)}</Tooltip>
              ),
            },
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
            { title: 'Bot Name', dataIndex: 'botName', width: 140, render: (v) => v ?? '—' },
            {
              title: 'Bot Type',
              dataIndex: 'botType',
              width: 110,
              render: (t: string | null) => (
                <Tag color={botTypeColor[t ?? 'unknown']}>{t ?? 'unknown'}</Tag>
              ),
            },
            {
              title: 'Cache',
              dataIndex: 'cacheHit',
              width: 100,
              render: (hit: boolean) =>
                hit ? <Badge status="success" text="HIT" /> : <Badge status="warning" text="MISS" />,
            },
            {
              title: 'Status',
              dataIndex: 'statusCode',
              width: 90,
              render: (code: number | null) => <Tag color={statusColor(code)}>{code ?? '—'}</Tag>,
            },
            {
              title: 'Response',
              dataIndex: 'responseTime',
              width: 110,
              render: (v: number | null) => (v != null ? `${v} ms` : '—'),
            },
          ]}
        />
      </Card>

      {/* ── HTML preview modal ──────────────────────────────────────────────── */}
      <Modal
        open={!!previewHtml}
        title={previewHtml?.url}
        onCancel={() => setPreviewHtml(null)}
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
            <code>{previewHtml?.html}</code>
          </pre>
        </Paragraph>
      </Modal>
    </div>
  )
}
