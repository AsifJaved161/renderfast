'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  Card,
  Table,
  Select,
  Input,
  Button,
  Tag,
  Space,
  Tooltip,
  Empty,
  Skeleton,
  Typography,
  message,
} from 'antd'
import {
  ReloadOutlined,
  ExportOutlined,
  DesktopOutlined,
  MobileOutlined,
} from '@ant-design/icons'
import { LineChart } from '@/components/charts/Charts'
import { downloadCsv } from '@/lib/export-csv'
import { useDashboard } from '@/lib/dashboard-context'

const { Title, Text } = Typography

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
interface Analytics {
  renderHistory?: HistoryRow[]
  renderTrend?: { date: string; renders: number }[]
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

function statusColor(code: number | null) {
  if (!code) return 'default'
  if (code < 300) return 'green'
  if (code < 400) return 'orange'
  return 'red'
}
const statusClass = (code: number | null) =>
  !code ? 'other' : code < 300 ? '2xx' : code < 400 ? '3xx' : code < 500 ? '4xx' : '5xx'

// Best-effort device + source derived from the render's user-agent / bot name.
const deviceOf = (ua: string | null): 'Mobile' | 'Desktop' =>
  ua && /mobi|android|iphone|ipad/i.test(ua) ? 'Mobile' : 'Desktop'
const sourceOf = (botName: string | null): 'Automated' | 'Crawler' =>
  botName && /recache|webhook/i.test(botName) ? 'Automated' : 'Crawler'

export default function RenderHistoryPage() {
  const { selectedSiteId } = useDashboard()

  // URL search filter (mirrors the competitor: contains / does not contain, min 3 chars).
  const [urlMode, setUrlMode] = useState<'contains' | 'excludes'>('contains')
  const [urlQuery, setUrlQuery] = useState('')
  const [tableKey, setTableKey] = useState(0) // bumped to clear column sorters/filters

  const params = new URLSearchParams({ type: 'history', limit: '200' })
  if (selectedSiteId) params.set('site_id', selectedSiteId)
  const { data, isLoading: loading, error, isValidating, mutate } = useSWR<Analytics>(
    `/api/analytics?${params.toString()}`
  )

  useEffect(() => {
    if (error) message.error('Failed to load render history')
  }, [error])

  const rows: HistoryRow[] = data?.renderHistory ?? []
  const trend = data?.renderTrend ?? []

  // Apply the URL contains/excludes filter (only once the user typed ≥3 chars).
  const q = urlQuery.trim().toLowerCase()
  const filtered =
    q.length < 3
      ? rows
      : rows.filter((r) => {
          const hit = r.url.toLowerCase().includes(q)
          return urlMode === 'contains' ? hit : !hit
        })

  function clearFilters() {
    setUrlQuery('')
    setUrlMode('contains')
    setTableKey((k) => k + 1)
  }

  function exportCsv() {
    downloadCsv(
      `render-history-${Date.now()}.csv`,
      ['Rendered At', 'URL', 'HTTP Status', 'Render Time (ms)', 'Device', 'Source', 'Bot Name', 'User Agent'],
      filtered.map((r) => [
        r.timestamp,
        r.url,
        r.statusCode ?? '',
        r.responseTime ?? '',
        deviceOf(r.userAgent),
        sourceOf(r.botName),
        r.botName ?? '',
        r.userAgent ?? '',
      ])
    )
  }

  return (
    <div style={{ margin: 16 }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          Render History
        </Title>
        <Text type="secondary">Pages that have been recently rendered.</Text>
      </div>

      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        {/* ── Render usage chart ────────────────────────────────────────────── */}
        <Card title="Render Usage">
          {loading ? (
            <Skeleton active paragraph={{ rows: 4 }} />
          ) : trend.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No renders yet" />
          ) : (
            <LineChart
              labels={trend.map((t) => (t.date.length > 5 ? t.date.slice(5) : t.date))}
              series={[{ label: 'Renders', color: '#722ed1', points: trend.map((t) => t.renders) }]}
              fill
              height={220}
            />
          )}
        </Card>

        {/* ── History table ─────────────────────────────────────────────────── */}
        <Card
          styles={{ body: { padding: 12 } }}
          title={
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
              }}
            >
              <Space.Compact>
                <Select
                  value={urlMode}
                  onChange={setUrlMode}
                  style={{ width: 150 }}
                  options={[
                    { value: 'contains', label: 'Contains' },
                    { value: 'excludes', label: 'Does not contain' },
                  ]}
                />
                <Input.Search
                  allowClear
                  placeholder="Filter by URL (min 3 characters)"
                  defaultValue={urlQuery}
                  onChange={(e) => setUrlQuery(e.target.value)}
                  style={{ width: 320 }}
                />
              </Space.Compact>
              <Space>
                <Tooltip title="Refresh">
                  <Button icon={<ReloadOutlined />} loading={isValidating} onClick={() => mutate()} />
                </Tooltip>
                <Button onClick={clearFilters}>Clear filters</Button>
                <Button icon={<ExportOutlined />} onClick={exportCsv} disabled={filtered.length === 0}>
                  Export
                </Button>
              </Space>
            </div>
          }
        >
          <Table<HistoryRow>
            key={tableKey}
            size="small"
            bordered
            loading={loading}
            rowKey={(r) => r.timestamp + r.url}
            dataSource={filtered}
            scroll={{ x: 900 }}
            pagination={{
              pageSize: 50,
              showSizeChanger: false,
              showTotal: (total, range) => `${range[0]}–${range[1]} of ${total}`,
            }}
            locale={{
              emptyText: (
                <Empty description="No renders yet — once crawlers hit your integrated domains, each render is logged here." />
              ),
            }}
            columns={[
              {
                title: 'Rendered At',
                dataIndex: 'timestamp',
                width: 160,
                align: 'center',
                defaultSortOrder: 'descend',
                sorter: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
                render: (v: string) => (
                  <Tooltip title={new Date(v).toLocaleString()}>{relativeTime(v)}</Tooltip>
                ),
              },
              {
                title: 'HTTP Status',
                dataIndex: 'statusCode',
                width: 130,
                align: 'center',
                sorter: (a, b) => (a.statusCode ?? 0) - (b.statusCode ?? 0),
                filters: [
                  { text: '2xx', value: '2xx' },
                  { text: '3xx', value: '3xx' },
                  { text: '4xx', value: '4xx' },
                  { text: '5xx', value: '5xx' },
                ],
                onFilter: (val, r) => statusClass(r.statusCode) === val,
                render: (code: number | null) => (
                  <Tag color={statusColor(code)} style={{ fontWeight: 500 }}>{code ?? '—'}</Tag>
                ),
              },
              {
                title: 'Render Time',
                dataIndex: 'responseTime',
                width: 130,
                align: 'center',
                sorter: (a, b) => (a.responseTime ?? 0) - (b.responseTime ?? 0),
                render: (v: number | null) => (v != null ? `${v} ms` : '—'),
              },
              {
                title: 'URL',
                dataIndex: 'url',
                ellipsis: true,
                render: (u: string) => (
                  <a href={u} target="_blank" rel="noopener noreferrer">{u}</a>
                ),
              },
              {
                title: 'Device',
                dataIndex: 'userAgent',
                width: 100,
                align: 'center',
                filters: [
                  { text: 'Desktop', value: 'Desktop' },
                  { text: 'Mobile', value: 'Mobile' },
                ],
                onFilter: (val, r) => deviceOf(r.userAgent) === val,
                render: (ua: string | null) => {
                  const d = deviceOf(ua)
                  return (
                    <Tooltip title={`Rendering optimized for ${d} crawlers`}>
                      {d === 'Mobile' ? <MobileOutlined /> : <DesktopOutlined />}
                    </Tooltip>
                  )
                },
              },
              {
                title: 'Source',
                dataIndex: 'botName',
                width: 120,
                sorter: (a, b) => sourceOf(a.botName).localeCompare(sourceOf(b.botName)),
                filters: [
                  { text: 'Automated', value: 'Automated' },
                  { text: 'Crawler', value: 'Crawler' },
                ],
                onFilter: (val, r) => sourceOf(r.botName) === val,
                render: (botName: string | null) => (
                  <Tooltip title={botName ?? 'Unknown crawler'}>{sourceOf(botName)}</Tooltip>
                ),
              },
            ]}
          />
        </Card>
      </Space>
    </div>
  )
}
