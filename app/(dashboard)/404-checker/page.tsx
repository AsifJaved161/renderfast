'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Statistic,
  Button,
  Select,
  Tabs,
  Table,
  Tag,
  Badge,
  Space,
  Tooltip,
  Typography,
  message,
} from 'antd'
import { ScanOutlined, LinkOutlined, ExportOutlined } from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'

const BRAND = '#2da01d'
const { Title } = Typography

interface BrokenLink {
  id: string
  site_id: string
  url: string
  source_url: string | null
  status_code: number | null
  detected_at: string
  resolved: boolean
}

export default function BrokenLinkCheckerPage() {
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [rows, setRows] = useState<BrokenLink[]>([])
  const [sites, setSites] = useState<{ id: string; domain: string }[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [tab, setTab] = useState<'all' | 'open' | 'resolved'>('all')

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
      const res = await fetch(`/api/broken-links?${params}`)
      const json = await res.json()
      setRows(json.data ?? [])
    } catch {
      message.error('Failed to load broken links')
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load()
  }, [load])

  async function runScan() {
    if (!siteId) {
      message.warning('Select a site to scan')
      return
    }
    setScanning(true)
    try {
      const res = await fetch('/api/broken-links', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Scan failed')
        return
      }
      if (data.message) {
        message.warning(data.message)
      } else {
        message.success(`Scanned ${data.scanned} URLs — ${data.broken} broken (${data.newlyFound ?? 0} new)`)
      }
      await load()
    } finally {
      setScanning(false)
    }
  }

  async function markResolved(id: string) {
    const res = await fetch(`/api/broken-links?id=${id}`, { method: 'PATCH' })
    if (res.ok) {
      message.success('Marked resolved')
      await load()
    } else {
      message.error('Update failed')
    }
  }

  // ── Summary counts ─────────────────────────────────────────────────────────
  const total = rows.length
  const notFound = rows.filter((r) => r.status_code === 404).length
  const serverErrors = rows.filter((r) => (r.status_code ?? 0) >= 500).length
  const resolved = rows.filter((r) => r.resolved).length

  const filtered = rows.filter((r) => {
    if (tab === 'open') return !r.resolved
    if (tab === 'resolved') return r.resolved
    return true
  })

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
          Broken Link Checker
        </Title>
        <Space wrap>
          <Select
            allowClear
            placeholder="Select a site"
            style={{ minWidth: 200 }}
            value={siteId}
            onChange={setSiteId}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <Button
            type="primary"
            icon={<ScanOutlined />}
            loading={scanning}
            onClick={runScan}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            {scanning ? 'Scanning…' : 'Run Scan'}
          </Button>
        </Space>
      </div>

      {/* ── Summary cards ───────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Dead links found on your site — bad for SEO & users.">Total Broken Links</StatTitle>} value={total} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Links pointing to pages that no longer exist (404).">404 Not Found</StatTitle>} value={notFound} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Links returning server errors (5xx) — your server failed to respond.">5xx Errors</StatTitle>} value={serverErrors} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="Broken links you’ve marked as fixed.">Resolved</StatTitle>} value={resolved} valueStyle={{ color: BRAND }} />
          </Card>
        </Col>
      </Row>

      {/* ── Tabs + table ────────────────────────────────────────────────────── */}
      <Card>
        <Tabs
          activeKey={tab}
          onChange={(k) => setTab(k as typeof tab)}
          items={[
            { key: 'all', label: `All (${total})` },
            { key: 'open', label: `Open (${total - resolved})` },
            { key: 'resolved', label: `Resolved (${resolved})` },
          ]}
        />
        <Table<BrokenLink>
          loading={loading}
          rowKey="id"
          dataSource={filtered}
          pagination={{ pageSize: 15, showSizeChanger: false }}
          columns={[
            {
              title: 'Broken URL',
              dataIndex: 'url',
              ellipsis: true,
              render: (url: string) => (
                <a href={url} target="_blank" rel="noreferrer">
                  <LinkOutlined /> {url}
                </a>
              ),
            },
            {
              title: 'Status Code',
              dataIndex: 'status_code',
              width: 120,
              render: (code: number | null) => (
                <Badge color="red" text={code ?? 'ERR'} />
              ),
            },
            {
              title: 'Source Page',
              dataIndex: 'source_url',
              ellipsis: true,
              render: (v: string | null) => v ?? '—',
            },
            {
              title: 'Detected At',
              dataIndex: 'detected_at',
              width: 180,
              render: (v: string) => new Date(v).toLocaleString(),
            },
            {
              title: 'Status',
              dataIndex: 'resolved',
              width: 110,
              render: (r: boolean) =>
                r ? <Tag color="green">Resolved</Tag> : <Tag color="red">Open</Tag>,
            },
            {
              title: 'Actions',
              width: 180,
              render: (_, row) => (
                <Space>
                  <Tooltip title="Open URL in new tab">
                    <Button
                      size="small"
                      icon={<ExportOutlined />}
                      onClick={() => window.open(row.url, '_blank', 'noopener')}
                    />
                  </Tooltip>
                  {!row.resolved && (
                    <Button size="small" onClick={() => markResolved(row.id)}>
                      Mark Resolved
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
