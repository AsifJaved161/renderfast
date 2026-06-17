'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Badge,
  Tooltip,
  Skeleton,
  Typography,
  message,
} from 'antd'
import {
  PlusCircleFilled,
  GlobalOutlined,
  CaretRightFilled,
  AppstoreOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography

type IntegrationType = 'script' | 'middleware' | 'worker' | 'nginx' | 'dns' | 'wordpress'

interface Site {
  id: string
  domain: string
  name: string | null
  status: 'active' | 'pending' | 'inactive'
  integration_type: IntegrationType | null
  render_count: number
}

const STATUS_BADGE: Record<Site['status'], 'success' | 'warning' | 'default'> = {
  active: 'success',
  pending: 'warning',
  inactive: 'default',
}

export default function DomainManagerPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<Site[]>([])
  const [limit, setLimit] = useState<number | null>(null)
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sites')
      const json = await res.json()
      setSites(json.sites ?? [])
      setLimit(json.limit ?? null)
    } catch {
      message.error('Failed to load sites')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function addDomain(values: { domain: string; name: string }) {
    setAdding(true)
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Failed to add site')
        return
      }
      message.success('Site added')
      setAddOpen(false)
      form.resetFields()
      await load()
      // Jump straight into the new site's details.
      if (data.site?.id) router.push(`/domain-manager/${data.site.id}`)
    } finally {
      setAdding(false)
    }
  }

  const atLimit = limit !== null && sites.length >= limit
  const open = (id: string) => router.push(`/domain-manager/${id}`)

  return (
    <div style={{ padding: 24 }}>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: '1px solid #f0f0f0',
          paddingBottom: 12,
          marginBottom: 24,
        }}
      >
        <Title level={3} style={{ margin: 0, fontWeight: 500 }}>
          My Sites
        </Title>
        <Button.Group>
          <Tooltip title="Grid view">
            <Button
              type={view === 'grid' ? 'primary' : 'default'}
              icon={<AppstoreOutlined />}
              onClick={() => setView('grid')}
              style={view === 'grid' ? { background: BRAND, borderColor: BRAND } : undefined}
            />
          </Tooltip>
          <Tooltip title="List view">
            <Button
              type={view === 'list' ? 'primary' : 'default'}
              icon={<UnorderedListOutlined />}
              onClick={() => setView('list')}
              style={view === 'list' ? { background: BRAND, borderColor: BRAND } : undefined}
            />
          </Tooltip>
        </Button.Group>
      </div>

      {loading ? (
        <Row gutter={[20, 20]}>
          {[0, 1, 2].map((i) => (
            <Col xs={24} sm={12} lg={8} key={i}>
              <Card style={{ minHeight: 180 }}>
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
      ) : view === 'grid' ? (
        <Row gutter={[20, 20]}>
          {sites.map((site) => (
            <Col xs={24} sm={12} lg={8} key={site.id}>
              <SiteCard site={site} onOpen={() => open(site.id)} />
            </Col>
          ))}
          {!atLimit && (
            <Col xs={24} sm={12} lg={8}>
              <AddCard onClick={() => setAddOpen(true)} />
            </Col>
          )}
        </Row>
      ) : (
        <Card styles={{ body: { padding: 0 } }}>
          {sites.map((site, i) => (
            <div
              key={site.id}
              onClick={() => open(site.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px',
                cursor: 'pointer',
                borderTop: i === 0 ? 'none' : '1px solid #f0f0f0',
              }}
            >
              <div>
                <Text strong style={{ fontSize: 15 }}>
                  {site.name || site.domain}
                </Text>
                <div style={{ fontSize: 13, color: '#6b7280' }}>{site.domain}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Badge status={STATUS_BADGE[site.status]} text={site.status} />
                <CaretRightFilled style={{ color: BRAND, fontSize: 18 }} />
              </div>
            </div>
          ))}
          {!atLimit && (
            <div
              onClick={() => setAddOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '16px 20px',
                cursor: 'pointer',
                borderTop: sites.length ? '1px solid #f0f0f0' : 'none',
                color: BRAND,
                fontWeight: 600,
              }}
            >
              <PlusCircleFilled /> Add a new site
            </div>
          )}
        </Card>
      )}

      {/* ── Add site modal ───────────────────────────────────────────────────── */}
      <Modal
        title="Add a new site"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adding}
        okText="Add site"
        okButtonProps={{ style: { background: BRAND, borderColor: BRAND } }}
      >
        <Form form={form} layout="vertical" onFinish={addDomain} requiredMark={false}>
          <Form.Item
            name="domain"
            label="Domain"
            rules={[
              { required: true, message: 'Enter your domain' },
              {
                pattern: /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/,
                message: 'Enter a bare domain like example.com',
              },
            ]}
          >
            <Input prefix={<GlobalOutlined />} placeholder="example.com" size="large" />
          </Form.Item>
          <Form.Item name="name" label="Site name" rules={[{ required: true, message: 'Enter a name' }]}>
            <Input placeholder="My Website" size="large" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

// ── Site card (grid) ──────────────────────────────────────────────────────────
function SiteCard({ site, onOpen }: { site: Site; onOpen: () => void }) {
  return (
    <Card
      hoverable
      onClick={onOpen}
      style={{ minHeight: 180, position: 'relative' }}
      styles={{ body: { height: 180, display: 'flex', flexDirection: 'column' } }}
    >
      <div style={{ flex: 1 }}>
        <Title level={4} style={{ margin: 0, color: '#1f2937' }}>
          {site.name || site.domain}
        </Title>
        <Text type="secondary">{site.domain}</Text>
        <div style={{ marginTop: 10 }}>
          <Badge status={STATUS_BADGE[site.status]} text={site.status} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Tooltip title="Open details">
          <CaretRightFilled style={{ color: BRAND, fontSize: 26 }} />
        </Tooltip>
      </div>
    </Card>
  )
}

// ── "Add a new site" card ─────────────────────────────────────────────────────
function AddCard({ onClick }: { onClick: () => void }) {
  return (
    <Card
      hoverable
      onClick={onClick}
      style={{ minHeight: 180, border: `1px dashed ${BRAND}` }}
      styles={{
        body: {
          height: 180,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        },
      }}
    >
      <Text style={{ color: BRAND, fontSize: 20, fontWeight: 700 }}>Add a new site</Text>
      <PlusCircleFilled style={{ color: BRAND, fontSize: 34 }} />
    </Card>
  )
}
