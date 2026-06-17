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
  LockOutlined,
  ThunderboltOutlined,
  DatabaseOutlined,
  RobotOutlined,
  WarningOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography

type IntegrationType = 'script' | 'middleware' | 'worker' | 'nginx' | 'dns' | 'wordpress'

interface SiteStats {
  renders: number
  cached: number
  botHits30: number
  brokenLinks: number
}

interface Site {
  id: string
  domain: string
  name: string | null
  status: 'active' | 'pending' | 'inactive'
  integration_type: IntegrationType | null
  render_count: number
  stats?: SiteStats
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
  const [plan, setPlan] = useState<string>('free')
  const [view, setView] = useState<'grid' | 'list'>('grid')
  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sites?with_stats=1')
      const json = await res.json()
      setSites(json.sites ?? [])
      setLimit(json.limit ?? null)
      setPlan(json.plan ?? 'free')
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
      // Sitemap auto-discovery + URL queueing now runs server-side (see POST /api/sites).
      if (data.site?.id) {
        message.info('Fetching sitemap — URLs will appear in the Sitemaps & Caching Queue sections.')
        router.push(`/domain-manager/${data.site.id}`)
      }
    } finally {
      setAdding(false)
    }
  }

  const atLimit = limit !== null && sites.length >= limit
  const open = (id: string) => router.push(`/domain-manager/${id}`)

  function tryAdd() {
    if (atLimit) {
      message.warning(
        `Your ${plan} plan allows ${limit} site${limit === 1 ? '' : 's'}. Upgrade your plan to add more.`
      )
      return
    }
    setAddOpen(true)
  }

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
          <Col xs={24} sm={12} lg={8}>
            <AddCard disabled={atLimit} plan={plan} limit={limit} onClick={tryAdd} />
          </Col>
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
          <div
            onClick={tryAdd}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '16px 20px',
              cursor: 'pointer',
              borderTop: sites.length ? '1px solid #f0f0f0' : 'none',
              color: atLimit ? '#bfbfbf' : BRAND,
              fontWeight: 600,
            }}
          >
            {atLimit ? <LockOutlined /> : <PlusCircleFilled />} Add a new site
            {atLimit && (
              <Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>
                — {plan} plan limit reached ({limit})
              </Text>
            )}
          </div>
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
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(/\.0$/, '') + 'k'
  return String(n)
}

function Stat({
  icon,
  label,
  value,
  danger,
}: {
  icon: React.ReactNode
  label: string
  value: number
  danger?: boolean
}) {
  return (
    <div style={{ flex: 1, textAlign: 'center' }}>
      <div style={{ color: danger && value > 0 ? '#ff4d4f' : BRAND, fontSize: 15 }}>{icon}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: danger && value > 0 ? '#ff4d4f' : '#1f2937', lineHeight: 1.2 }}>
        {fmt(value)}
      </div>
      <div style={{ fontSize: 11, color: '#9ca3af' }}>{label}</div>
    </div>
  )
}

function SiteCard({ site, onOpen }: { site: Site; onOpen: () => void }) {
  const s = site.stats
  return (
    <Card
      hoverable
      onClick={onOpen}
      style={{ minHeight: 210, position: 'relative' }}
      styles={{ body: { minHeight: 210, display: 'flex', flexDirection: 'column' } }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ minWidth: 0 }}>
          <Title level={4} style={{ margin: 0, color: '#1f2937' }} ellipsis>
            {site.name || site.domain}
          </Title>
          <Text type="secondary">{site.domain}</Text>
          <div style={{ marginTop: 8 }}>
            <Badge status={STATUS_BADGE[site.status]} text={site.status} />
          </div>
        </div>
        <Tooltip title="Open details">
          <CaretRightFilled style={{ color: BRAND, fontSize: 24 }} />
        </Tooltip>
      </div>

      {/* ── Insights ────────────────────────────────────────────────────────── */}
      <div
        style={{
          marginTop: 'auto',
          paddingTop: 16,
          display: 'flex',
          gap: 4,
          borderTop: '1px solid #f0f0f0',
        }}
      >
        <Stat icon={<ThunderboltOutlined />} label="Renders" value={s?.renders ?? 0} />
        <Stat icon={<DatabaseOutlined />} label="Cached" value={s?.cached ?? 0} />
        <Stat icon={<RobotOutlined />} label="Bots 30d" value={s?.botHits30 ?? 0} />
        <Stat icon={<WarningOutlined />} label="Broken" value={s?.brokenLinks ?? 0} danger />
      </div>
    </Card>
  )
}

// ── "Add a new site" card ─────────────────────────────────────────────────────
function AddCard({
  onClick,
  disabled,
  plan,
  limit,
}: {
  onClick: () => void
  disabled: boolean
  plan: string
  limit: number | null
}) {
  const card = (
    <Card
      hoverable={!disabled}
      onClick={onClick}
      style={{
        minHeight: 210,
        border: `1px dashed ${disabled ? '#d9d9d9' : BRAND}`,
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: disabled ? '#fafafa' : undefined,
      }}
      styles={{
        body: {
          minHeight: 210,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
        },
      }}
    >
      {disabled ? (
        <>
          <LockOutlined style={{ color: '#bfbfbf', fontSize: 32 }} />
          <Text style={{ color: '#8c8c8c', fontSize: 16, fontWeight: 600 }}>Add a new site</Text>
          <Text type="secondary" style={{ fontSize: 12, textAlign: 'center' }}>
            {plan} plan allows {limit} site{limit === 1 ? '' : 's'}.
            <br />
            Upgrade to add more.
          </Text>
        </>
      ) : (
        <>
          <Text style={{ color: BRAND, fontSize: 20, fontWeight: 700 }}>Add a new site</Text>
          <PlusCircleFilled style={{ color: BRAND, fontSize: 34 }} />
        </>
      )}
    </Card>
  )

  return disabled ? (
    <Tooltip title={`Upgrade from the ${plan} plan to add more sites`}>{card}</Tooltip>
  ) : (
    card
  )
}
