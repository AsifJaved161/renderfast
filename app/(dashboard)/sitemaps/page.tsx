'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Button,
  Modal,
  Form,
  Input,
  Select,
  Table,
  Badge,
  Popconfirm,
  Tooltip,
  Space,
  Typography,
  message,
  notification,
} from 'antd'
import {
  PlusOutlined,
  ReloadOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title } = Typography

interface Site {
  id: string
  domain: string
}

interface Sitemap {
  id: string
  site_id: string
  sitemap_url: string
  urls_found: number
  status: 'active' | 'paused' | 'error'
  last_crawled_at: string | null
}

const STATUS_BADGE: Record<Sitemap['status'], 'success' | 'warning' | 'error'> = {
  active: 'success',
  paused: 'warning',
  error: 'error',
}

function relativeTime(iso: string | null) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function SitemapsPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Sitemap[]>([])
  const [sites, setSites] = useState<Site[]>([])
  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [crawlingId, setCrawlingId] = useState<string | null>(null)
  const [form] = Form.useForm()

  const domainOf = (id: string) => sites.find((s) => s.id === id)?.domain ?? '—'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [smRes, siteRes] = await Promise.all([
        fetch('/api/sitemaps').then((r) => r.json()),
        fetch('/api/sites').then((r) => r.json()),
      ])
      setRows(smRes.data ?? [])
      setSites(siteRes.sites ?? [])
    } catch {
      message.error('Failed to load sitemaps')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addSitemap(values: { site_id: string; sitemap_url: string }) {
    setAdding(true)
    try {
      const res = await fetch('/api/sitemaps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Failed to add sitemap')
        return
      }
      message.success('Sitemap added')
      setAddOpen(false)
      form.resetFields()
      await load()
    } finally {
      setAdding(false)
    }
  }

  async function recrawl(row: Sitemap) {
    setCrawlingId(row.id)
    try {
      const res = await fetch('/api/sitemaps/crawl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sitemap_id: row.id, sitemap_url: row.sitemap_url }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Crawl failed')
        return
      }
      notification.success({
        message: 'Sitemap crawled',
        description: `${data.queued} URLs queued for rendering.`,
      })
      await load()
    } finally {
      setCrawlingId(null)
    }
  }

  async function toggleStatus(row: Sitemap) {
    const next = row.status === 'paused' ? 'active' : 'paused'
    const res = await fetch(`/api/sitemaps?id=${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    if (res.ok) {
      message.success(next === 'paused' ? 'Paused' : 'Resumed')
      await load()
    } else {
      message.error('Update failed')
    }
  }

  async function deleteSitemap(id: string) {
    const res = await fetch(`/api/sitemaps?id=${id}`, { method: 'DELETE' })
    if (res.ok) {
      message.success('Deleted')
      await load()
    } else {
      message.error('Delete failed')
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          Sitemaps
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAddOpen(true)}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          Add Sitemap
        </Button>
      </div>

      <Card>
        <Table<Sitemap>
          loading={loading}
          rowKey="id"
          dataSource={rows}
          columns={[
            { title: 'Sitemap URL', dataIndex: 'sitemap_url', ellipsis: true },
            {
              title: 'Domain',
              dataIndex: 'site_id',
              width: 180,
              render: (id: string) => domainOf(id),
            },
            { title: 'URLs Found', dataIndex: 'urls_found', width: 120 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 120,
              render: (s: Sitemap['status']) => <Badge status={STATUS_BADGE[s]} text={s} />,
            },
            {
              title: 'Last Crawled',
              dataIndex: 'last_crawled_at',
              width: 140,
              render: (v: string | null) => relativeTime(v),
            },
            {
              title: 'Actions',
              width: 180,
              render: (_, row) => (
                <Space>
                  <Tooltip title="Re-crawl Now">
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      loading={crawlingId === row.id}
                      onClick={() => recrawl(row)}
                    />
                  </Tooltip>
                  <Tooltip title={row.status === 'paused' ? 'Resume' : 'Pause'}>
                    <Button
                      size="small"
                      icon={row.status === 'paused' ? <PlayCircleOutlined /> : <PauseCircleOutlined />}
                      onClick={() => toggleStatus(row)}
                    />
                  </Tooltip>
                  <Popconfirm title="Delete this sitemap?" onConfirm={() => deleteSitemap(row.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Add sitemap modal ───────────────────────────────────────────────── */}
      <Modal
        title="Add Sitemap"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adding}
        okText="Add"
        okButtonProps={{ style: { background: BRAND, borderColor: BRAND } }}
      >
        <Form form={form} layout="vertical" onFinish={addSitemap} requiredMark={false}>
          <Form.Item name="site_id" label="Site" rules={[{ required: true, message: 'Select a site' }]}>
            <Select
              placeholder="Select a domain"
              options={sites.map((s) => ({ value: s.id, label: s.domain }))}
            />
          </Form.Item>
          <Form.Item
            name="sitemap_url"
            label="Sitemap URL"
            rules={[
              { required: true, message: 'Enter the sitemap URL' },
              { type: 'url', message: 'Enter a valid URL' },
            ]}
          >
            <Input placeholder="https://example.com/sitemap.xml" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
