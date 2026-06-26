'use client'

import useSWR from 'swr'
import { Card, Table, Tag, Space, Button, Typography, Empty, message } from 'antd'
import { RedoOutlined, ExportOutlined } from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'
import { downloadCsv } from '@/lib/export-csv'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text } = Typography

interface QueueItem {
  id: string
  url: string
  status: string
  attempts: number
  error_message: string | null
}

// Map a raw render error message to a human error type (mirrors the competitor's
// typed error列 — HTTP / blank / timeout / network / quota / invalid / other).
function classify(msg: string | null): { type: string; color: string } {
  const m = (msg ?? '').toLowerCase()
  if (!m) return { type: 'Unknown error', color: 'default' }
  if (/rate.?limit|quota|too many/.test(m)) return { type: 'Quota / rate limit', color: 'gold' }
  if (/timeout|timed out|deadline|navigation timeout/.test(m)) return { type: 'Timeout', color: 'orange' }
  if (/\bhttp\b|\b[45]\d\d\b|status\s*code/.test(m)) return { type: 'HTTP error', color: 'red' }
  if (/net\b|network|enotfound|econnrefused|dns|fetch failed|unreachable/.test(m)) return { type: 'Network error', color: 'volcano' }
  if (/empty|blank|no content|empty render/.test(m)) return { type: 'Blank page', color: 'purple' }
  if (/invalid url|invalid mime|mime type/.test(m)) return { type: 'Invalid page', color: 'magenta' }
  return { type: 'Other error', color: 'default' }
}

export default function RenderErrorsPage() {
  const { selectedSiteId, sites } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const params = new URLSearchParams({ status: 'failed', limit: '100' })
  if (siteId) params.set('site_id', siteId)
  const { data, isLoading, mutate } = useSWR<{ data: QueueItem[]; total: number }>(`/api/queue?${params}`)
  const rows = data?.data ?? []
  const total = data?.total ?? 0

  // Per-type counts for the summary chips.
  const byType = new Map<string, number>()
  for (const r of rows) {
    const t = classify(r.error_message).type
    byType.set(t, (byType.get(t) ?? 0) + 1)
  }

  async function retry(id: string) {
    const res = await fetch(`/api/queue?id=${id}`, { method: 'PATCH' })
    if (res.ok) {
      message.success('Re-queued for rendering')
      await mutate()
    } else message.error('Retry failed')
  }

  async function retryAll() {
    const p = new URLSearchParams({ status: 'failed' })
    if (siteId) p.set('site_id', siteId)
    const res = await fetch(`/api/queue?${p}`, { method: 'PATCH' })
    if (res.ok) {
      message.success('All failed URLs re-queued')
      await mutate()
    } else message.error('Retry failed')
  }

  function exportCsv() {
    downloadCsv(
      `render-errors-${Date.now()}.csv`,
      ['URL', 'Error type', 'Message', 'Attempts'],
      rows.map((r) => [r.url, classify(r.error_message).type, r.error_message ?? '', r.attempts])
    )
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>Render Errors</Title>
        <Space wrap>
          <Button icon={<ExportOutlined />} onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
          <Button type="primary" icon={<RedoOutlined />} onClick={retryAll} disabled={rows.length === 0} style={{ background: BRAND, borderColor: BRAND }}>
            Retry all
          </Button>
        </Space>
      </div>
      <Text type="secondary">
        Pages whose render failed{siteId ? '' : ' across all your sites'} — grouped by reason. Fix the
        page or retry; cache hits and successful renders aren&apos;t shown here.
      </Text>

      {/* ── Type summary ──────────────────────────────────────────────────────── */}
      {byType.size > 0 && (
        <div style={{ margin: '16px 0' }}>
          <Space wrap>
            {[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => (
              <Tag key={t} color={classify(rowsForType(rows, t)).color} style={{ fontSize: 13, padding: '2px 10px' }}>
                {t}: <strong>{n}</strong>
              </Tag>
            ))}
          </Space>
        </div>
      )}

      <Card style={{ marginTop: 16 }}>
        <Table<QueueItem>
          rowKey="id"
          loading={isLoading}
          dataSource={rows}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          locale={{ emptyText: <Empty description={siteId && !sites.length ? 'Add a site first.' : 'No render errors 🎉'} /> }}
          columns={[
            { title: 'URL', dataIndex: 'url', ellipsis: true, render: (u: string) => <a href={u} target="_blank" rel="noopener noreferrer">{u}</a> },
            {
              title: <StatTitle hint="Why the render failed, inferred from the error.">Type</StatTitle>,
              width: 170,
              render: (_, r) => {
                const c = classify(r.error_message)
                return <Tag color={c.color}>{c.type}</Tag>
              },
            },
            { title: 'Message', dataIndex: 'error_message', ellipsis: true, render: (m: string | null) => m ?? '—' },
            { title: 'Attempts', dataIndex: 'attempts', width: 100 },
            {
              title: 'Action',
              width: 110,
              render: (_, r) => <Button size="small" icon={<RedoOutlined />} onClick={() => retry(r.id)}>Retry</Button>,
            },
          ]}
        />
        {total > rows.length && (
          <Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            Showing the latest {rows.length} of {total} failed URLs.
          </Text>
        )}
      </Card>
    </div>
  )
}

// Helper so a chip can reuse the colour for a given type label.
function rowsForType(rows: QueueItem[], type: string): string | null {
  const hit = rows.find((r) => classify(r.error_message).type === type)
  return hit?.error_message ?? null
}
