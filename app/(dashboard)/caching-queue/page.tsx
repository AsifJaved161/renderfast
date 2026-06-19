'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Row,
  Col,
  Card,
  Statistic,
  Button,
  Modal,
  Input,
  Select,
  Table,
  Tag,
  Tooltip,
  Popconfirm,
  Badge,
  Space,
  Typography,
  message,
} from 'antd'
import {
  PlusOutlined,
  PlayCircleOutlined,
  RedoOutlined,
  DeleteOutlined,
  ClearOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'

const BRAND = '#2da01d'
const { Title } = Typography
const { TextArea } = Input

type Status = 'pending' | 'rendering' | 'completed' | 'failed'

interface QueueItem {
  id: string
  site_id: string
  url: string
  priority: number
  status: Status
  attempts: number
  error_message: string | null
}

const STATUS_TAG: Record<Status, string> = {
  pending: 'blue',
  rendering: 'orange',
  completed: 'green',
  failed: 'red',
}

export default function CachingQueuePage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<QueueItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [summary, setSummary] = useState({ pending: 0, rendering: 0, completed: 0, failed: 0 })
  const [sites, setSites] = useState<{ id: string; domain: string }[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [statusFilter, setStatusFilter] = useState<Status | undefined>()
  const [addOpen, setAddOpen] = useState(false)
  const [addSite, setAddSite] = useState<string | undefined>()
  const [urlText, setUrlText] = useState('')
  const [adding, setAdding] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [live, setLive] = useState(false)
  const LIMIT = 20

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => setSites(d.sites ?? []))
      .catch(() => setSites([]))
  }, [])

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (siteId) params.set('site_id', siteId)
      if (statusFilter) params.set('status', statusFilter)

      const sumParams = new URLSearchParams({ summary: 'true' })
      if (siteId) sumParams.set('site_id', siteId)

      const [list, sum] = await Promise.all([
        fetch(`/api/queue?${params}`).then((r) => r.json()),
        fetch(`/api/queue?${sumParams}`).then((r) => r.json()),
      ])
      setRows(list.data ?? [])
      setTotal(list.total ?? 0)
      if (sum.summary) setSummary(sum.summary)
    } catch {
      message.error('Failed to load queue')
    } finally {
      setLoading(false)
    }
  }, [page, siteId, statusFilter])

  useEffect(() => {
    setLoading(true)
    load()
  }, [load])

  // ── Auto-refresh every 5s while anything is rendering ──────────────────────
  const hasRendering = rows.some((r) => r.status === 'rendering') || summary.rendering > 0
  useEffect(() => {
    if (hasRendering) {
      setLive(true)
      timerRef.current = setInterval(load, 5000)
    } else {
      setLive(false)
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [hasRendering, load])

  async function addUrls() {
    if (!addSite) {
      message.warning('Select a site')
      return
    }
    const urls = urlText
      .split('\n')
      .map((u) => u.trim())
      .filter(Boolean)
    if (urls.length === 0) {
      message.warning('Paste at least one URL')
      return
    }
    setAdding(true)
    try {
      const res = await fetch('/api/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: addSite, urls }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Failed to add URLs')
        return
      }
      message.success(`Added ${data.added} URLs`)
      setAddOpen(false)
      setUrlText('')
      await load()
    } finally {
      setAdding(false)
    }
  }

  // Drain the queue: keep processing batches until nothing is left (or a cap).
  async function processQueue() {
    setProcessing(true)
    const hide = message.loading('Processing queue…', 0)
    try {
      let processed = 0
      let failed = 0
      for (let i = 0; i < 40; i++) {
        const res = await fetch('/api/queue/process', { method: 'POST' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          message.error(data.error ?? 'Processing failed')
          break
        }
        const data = await res.json()
        processed += data.processed ?? 0
        failed += data.failed ?? 0
        await load()
        if (!data.processed && !data.failed) break
      }
      hide()
      if (processed || failed) message.success(`Done — rendered ${processed}, failed ${failed}`)
      else message.info('Nothing pending to process')
    } finally {
      hide()
      setProcessing(false)
    }
  }

  async function retry(id: string) {
    await fetch(`/api/queue?id=${id}`, { method: 'PATCH' })
    message.success('Reset to pending')
    await load()
  }

  async function remove(id: string) {
    await fetch(`/api/queue?id=${id}`, { method: 'DELETE' })
    message.success('Removed')
    await load()
  }

  async function retryFailed() {
    const params = new URLSearchParams({ status: 'failed' })
    if (siteId) params.set('site_id', siteId)
    const res = await fetch(`/api/queue?${params}`, { method: 'PATCH' })
    if (res.ok) {
      message.success('All failed URLs reset to pending')
      await load()
    } else {
      message.error('Retry failed')
    }
  }

  async function clearCompleted() {
    const params = new URLSearchParams({ status: 'completed' })
    if (siteId) params.set('site_id', siteId)
    const res = await fetch(`/api/queue?${params}`, { method: 'DELETE' })
    if (res.ok) {
      message.success('Cleared completed URLs')
      await load()
    } else {
      message.error('Clear failed')
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
        <Space>
          <Title level={3} style={{ margin: 0 }}>
            Caching Queue
          </Title>
          {live && <Badge status="processing" text="Live" />}
        </Space>
        <Space wrap>
          <Select
            allowClear
            placeholder="All sites"
            style={{ minWidth: 180 }}
            value={siteId}
            onChange={(v) => {
              setSiteId(v)
              setPage(1)
            }}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <Select
            allowClear
            placeholder="All statuses"
            style={{ minWidth: 150 }}
            value={statusFilter}
            onChange={(v) => {
              setStatusFilter(v)
              setPage(1)
            }}
            options={[
              { value: 'pending', label: 'Pending' },
              { value: 'rendering', label: 'Rendering' },
              { value: 'completed', label: 'Completed' },
              { value: 'failed', label: 'Failed' },
            ]}
          />
          {summary.failed > 0 && (
            <Tooltip title="Reset all failed URLs to pending">
              <Button icon={<RedoOutlined />} onClick={retryFailed}>
                Retry failed ({summary.failed})
              </Button>
            </Tooltip>
          )}
          {summary.completed > 0 && (
            <Popconfirm title="Clear all completed URLs from the queue?" onConfirm={clearCompleted} okText="Clear">
              <Button icon={<ClearOutlined />}>Clear completed</Button>
            </Popconfirm>
          )}
          <Button icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
            Add URLs
          </Button>
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            loading={processing}
            onClick={processQueue}
            disabled={summary.pending === 0}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            Process Queue{summary.pending ? ` (${summary.pending})` : ''}
          </Button>
        </Space>
      </div>

      {/* ── Stats bar ───────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="URLs waiting to be rendered & cached.">Pending</StatTitle>} value={summary.pending} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="URLs being rendered right now.">Rendering</StatTitle>} value={summary.rendering} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="URLs successfully rendered & cached.">Completed</StatTitle>} value={summary.completed} valueStyle={{ color: BRAND }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title={<StatTitle hint="URLs that couldn’t be rendered — you can retry them.">Failed</StatTitle>} value={summary.failed} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <Card>
        <Table<QueueItem>
          loading={loading}
          rowKey="id"
          dataSource={rows}
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
              render: (u: string) => (
                <a href={u} target="_blank" rel="noopener noreferrer">
                  {u}
                </a>
              ),
            },
            { title: 'Priority', dataIndex: 'priority', width: 100 },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 120,
              render: (s: Status) => <Tag color={STATUS_TAG[s]}>{s}</Tag>,
            },
            { title: 'Attempts', dataIndex: 'attempts', width: 100 },
            {
              title: 'Error',
              dataIndex: 'error_message',
              width: 120,
              render: (err: string | null) =>
                err ? (
                  <Tooltip title={err}>
                    <Tag color="red">error</Tag>
                  </Tooltip>
                ) : (
                  '—'
                ),
            },
            {
              title: 'Actions',
              width: 150,
              render: (_, row) => (
                <Space>
                  <Tooltip title="Open URL in new tab">
                    <Button
                      size="small"
                      icon={<ExportOutlined />}
                      onClick={() => window.open(row.url, '_blank', 'noopener')}
                    />
                  </Tooltip>
                  <Tooltip title="Retry">
                    <Button size="small" icon={<RedoOutlined />} onClick={() => retry(row.id)} />
                  </Tooltip>
                  <Popconfirm title="Remove from queue?" onConfirm={() => remove(row.id)}>
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                </Space>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Add URLs modal ──────────────────────────────────────────────────── */}
      <Modal
        title="Add URLs to Queue"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={addUrls}
        confirmLoading={adding}
        okText="Add"
        okButtonProps={{ style: { background: BRAND, borderColor: BRAND } }}
      >
        <Select
          placeholder="Select a site"
          style={{ width: '100%', marginBottom: 12 }}
          value={addSite}
          onChange={setAddSite}
          options={sites.map((s) => ({ value: s.id, label: s.domain }))}
        />
        <TextArea
          rows={8}
          placeholder={'https://example.com/page-1\nhttps://example.com/page-2'}
          value={urlText}
          onChange={(e) => setUrlText(e.target.value)}
        />
      </Modal>
    </div>
  )
}
