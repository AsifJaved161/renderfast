'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  Card,
  Button,
  Select,
  Table,
  Tag,
  Tooltip,
  Space,
  Typography,
  Empty,
  InputNumber,
  message,
  notification,
} from 'antd'
import {
  ReloadOutlined,
  ThunderboltOutlined,
  GlobalOutlined,
  SyncOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text } = Typography

interface SitemapMeta {
  sitemap_url: string
  urls_found: number
  status: string
  last_crawled_at: string | null
  check_interval_days?: number
}

type UrlStatus = 'pending' | 'rendering' | 'completed' | 'failed'

interface UrlRow {
  id: string
  url: string
  status: UrlStatus
  statusCode: number | null
  renderTimeMs: number | null
  cached: boolean
  error: string | null
  attempts: number
}

interface Counts {
  pending: number
  rendering: number
  completed: number
  failed: number
  total: number
}

const STATUS_TAG: Record<UrlStatus, { color: string; label: string }> = {
  completed: { color: 'green', label: 'Rendered' },
  rendering: { color: 'processing', label: 'Rendering' },
  pending: { color: 'default', label: 'Queued' },
  failed: { color: 'red', label: 'Failed' },
}

function relativeTime(iso: string | null) {
  if (!iso) return 'Never'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SitemapsPage() {
  const { sites } = useDashboard() // shared site list from the layout — no extra call
  const [siteId, setSiteId] = useState<string | undefined>()
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState<UrlStatus | undefined>()
  const [fetching, setFetching] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [checking, setChecking] = useState(false)
  const [recheckDays, setRecheckDays] = useState(5)
  const limit = 25

  // Default to the first site once the shared list arrives.
  useEffect(() => {
    setSiteId((prev) => prev ?? sites[0]?.id)
  }, [sites])

  // URLs (paginated) + sitemap meta via SWR — cached per site/page/filter key.
  const urlParams = new URLSearchParams({ site_id: siteId ?? '', page: String(page), limit: String(limit) })
  if (statusFilter) urlParams.set('status', statusFilter)
  const { data: urlData, isLoading: loading, error, mutate: mutateUrls } = useSWR<{
    urls: UrlRow[]
    total: number
    counts: Counts
  }>(siteId ? `/api/sitemaps/urls?${urlParams}` : null)
  const { data: smData, mutate: mutateMeta } = useSWR<{ data: SitemapMeta[] }>(
    siteId ? `/api/sitemaps?site_id=${siteId}` : null
  )

  const urls = urlData?.urls ?? []
  const total = urlData?.total ?? 0
  const counts: Counts = urlData?.counts ?? { pending: 0, rendering: 0, completed: 0, failed: 0, total: 0 }
  const meta = (smData?.data ?? [])[0] ?? null

  // Revalidate both the URL list and the sitemap meta (after any mutation).
  const reload = () => Promise.all([mutateUrls(), mutateMeta()])

  useEffect(() => {
    if (error) message.error('Failed to load URLs')
  }, [error])

  // Adopt the saved re-check interval once meta loads.
  useEffect(() => {
    if (meta?.check_interval_days) setRecheckDays(meta.check_interval_days)
  }, [meta?.check_interval_days])

  // Reset to page 1 when the site or filter changes.
  useEffect(() => {
    setPage(1)
  }, [siteId, statusFilter])

  async function fetchSitemap() {
    if (!siteId) return
    setFetching(true)
    try {
      const res = await fetch('/api/sitemaps/auto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Could not fetch sitemap')
        return
      }
      notification.success({
        message: 'Sitemap fetched',
        description: `${data.found} URLs found · ${data.queued} newly queued.`,
      })
      await reload()
    } finally {
      setFetching(false)
    }
  }

  // Render pending URLs in a few batches (the processor does 5 per call).
  async function renderPending() {
    setRendering(true)
    try {
      let totalProcessed = 0
      for (let i = 0; i < 6; i++) {
        const res = await fetch('/api/queue/process', { method: 'POST' })
        if (!res.ok) break
        const data = await res.json()
        totalProcessed += data.processed ?? 0
        if (!data.processed) break
      }
      if (totalProcessed > 0) message.success(`Rendered ${totalProcessed} URL(s)`)
      else message.info('Nothing pending to render')
      await reload()
    } finally {
      setRendering(false)
    }
  }

  // Re-crawl the sitemap now and queue only new / newer-<lastmod> pages.
  // Also saves the re-check interval used by the daily cron.
  async function recheckNow() {
    if (!siteId) return
    setChecking(true)
    try {
      const res = await fetch('/api/sitemaps/recheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, interval_days: recheckDays }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Re-check failed')
        return
      }
      notification.success({
        message: 'Sitemap re-checked',
        description:
          data.queued > 0
            ? `${data.found} URLs scanned · ${data.queued} new/updated page(s) queued for render.`
            : `${data.found} URLs scanned · nothing changed since last render.`,
      })
      await reload()
    } finally {
      setChecking(false)
    }
  }

  // Download the generated sitemap.xml. A same-origin GET sends the auth cookie;
  // the route replies with a Content-Disposition attachment so it downloads.
  function downloadSitemap() {
    if (!siteId) return
    const a = document.createElement('a')
    a.href = `/api/sitemaps/download?site_id=${siteId}`
    a.download = ''
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  const chip = (label: string, value: number, color: string) => (
    <Tag color={color} style={{ fontSize: 13, padding: '2px 10px' }}>
      {label}: <strong>{value}</strong>
    </Tag>
  )

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          Sitemaps
        </Title>
        <Space wrap>
          <Select
            placeholder="Select a site"
            style={{ minWidth: 220 }}
            value={siteId}
            onChange={setSiteId}
            options={sites.map((s) => ({ value: s.id, label: s.name || s.domain }))}
          />
          <Button icon={<ReloadOutlined />} loading={fetching} onClick={fetchSitemap} disabled={!siteId}>
            Fetch sitemap
          </Button>
          <Tooltip title="Download a sitemap.xml built from this site's rendered pages">
            <Button icon={<DownloadOutlined />} onClick={downloadSitemap} disabled={!siteId || counts.completed === 0}>
              Download sitemap
            </Button>
          </Tooltip>
          <Button
            type="primary"
            icon={<ThunderboltOutlined />}
            loading={rendering}
            onClick={renderPending}
            disabled={!siteId || counts.pending === 0}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            Render pending{counts.pending ? ` (${counts.pending})` : ''}
          </Button>
        </Space>
      </div>

      {!siteId ? (
        <Card>
          <Empty description="Add a domain first — its sitemap is fetched automatically." />
        </Card>
      ) : (
        <>
          {/* ── Sitemap summary ─────────────────────────────────────────────── */}
          <Card style={{ marginBottom: 16 }} styles={{ body: { padding: '14px 20px' } }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div style={{ minWidth: 0 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  <GlobalOutlined /> Sitemap
                </Text>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 480 }}>
                  {meta?.sitemap_url ?? '— not fetched yet —'}
                </div>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {meta ? `${meta.urls_found} URLs · last fetched ${relativeTime(meta.last_crawled_at)}` : 'Click “Fetch sitemap” to discover URLs'}
                </Text>
              </div>
              <Space wrap>
                {chip('Total', counts.total, 'blue')}
                {chip('Rendered', counts.completed, 'green')}
                {chip('Queued', counts.pending, 'default')}
                {chip('Failed', counts.failed, 'red')}
              </Space>
            </div>

            {/* ── Auto re-check interval ─────────────────────────────────────── */}
            <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <SyncOutlined style={{ color: BRAND }} />
              <Text type="secondary">Auto re-check sitemap every</Text>
              <InputNumber min={1} max={90} value={recheckDays} onChange={(v) => setRecheckDays(v ?? 5)} style={{ width: 70 }} />
              <Text type="secondary">days — only pages with a newer date get re-rendered (saves renders).</Text>
              <Tooltip title="Re-crawl the sitemap now: queues only new pages and ones whose sitemap date is newer than the cached copy.">
                <Button size="small" icon={<ReloadOutlined />} loading={checking} onClick={recheckNow} disabled={!siteId}>
                  Save &amp; check now
                </Button>
              </Tooltip>
            </div>
          </Card>

          {/* ── URLs table ──────────────────────────────────────────────────── */}
          <Card
            title="URLs"
            extra={
              <Select
                allowClear
                placeholder="All statuses"
                style={{ width: 160 }}
                value={statusFilter}
                onChange={(v) => setStatusFilter(v)}
                options={[
                  { value: 'completed', label: 'Rendered' },
                  { value: 'pending', label: 'Queued' },
                  { value: 'rendering', label: 'Rendering' },
                  { value: 'failed', label: 'Failed' },
                ]}
              />
            }
          >
            <Table<UrlRow>
              loading={loading}
              rowKey="id"
              dataSource={urls}
              pagination={{
                current: page,
                pageSize: limit,
                total,
                showSizeChanger: false,
                onChange: setPage,
              }}
              locale={{ emptyText: <Empty description="No URLs yet — fetch the sitemap to populate this." /> }}
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
                  title: 'Status',
                  dataIndex: 'status',
                  width: 130,
                  render: (s: UrlStatus, row) => (
                    <Tooltip title={row.error ?? undefined}>
                      <Tag color={STATUS_TAG[s].color}>{STATUS_TAG[s].label}</Tag>
                    </Tooltip>
                  ),
                },
                {
                  title: 'HTTP',
                  dataIndex: 'statusCode',
                  width: 80,
                  render: (c: number | null) =>
                    c ? <Tag color={c < 400 ? 'green' : 'red'}>{c}</Tag> : <Text type="secondary">—</Text>,
                },
                {
                  title: 'Render time',
                  dataIndex: 'renderTimeMs',
                  width: 120,
                  render: (t: number | null) => (t != null ? `${t} ms` : <Text type="secondary">—</Text>),
                },
              ]}
            />
          </Card>
        </>
      )}
    </div>
  )
}
