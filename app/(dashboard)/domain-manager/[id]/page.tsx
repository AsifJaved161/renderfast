'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Row,
  Col,
  Card,
  Button,
  Form,
  Input,
  Select,
  Statistic,
  Badge,
  Tag,
  Popconfirm,
  Skeleton,
  Result,
  Typography,
  Space,
  message,
} from 'antd'
import {
  ArrowLeftOutlined,
  RocketOutlined,
  DeleteOutlined,
  GlobalOutlined,
  ThunderboltOutlined,
  CalendarOutlined,
} from '@ant-design/icons'
import { SiteAdvancedSettings } from '@/components/dashboard/SiteAdvancedSettings'
import type { SiteSettings } from '@/lib/site-settings'

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
  created_at: string
  settings?: Partial<SiteSettings> | null
}

const STATUS_BADGE: Record<Site['status'], 'success' | 'warning' | 'default'> = {
  active: 'success',
  pending: 'warning',
  inactive: 'default',
}

const INTEGRATION_LABEL: Record<string, string> = {
  script: 'Universal (Node / PHP)',
  middleware: 'Next.js / Vercel',
  worker: 'Cloudflare Worker',
  nginx: 'Nginx / Apache',
  dns: 'DNS',
  wordpress: 'WordPress',
}

export default function SiteDetailPage() {
  const router = useRouter()
  const { id } = useParams<{ id: string }>()
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [form] = Form.useForm()

  // Site details via SWR (cached per id). The global fetcher throws on non-2xx,
  // so a 404 surfaces as an error whose message carries the status code.
  const { data, error, isLoading: loading, mutate } = useSWR<{
    site: Site
    stats?: { rendersLast30Days?: number }
  }>(id ? `/api/sites/${id}` : null)
  const site = data?.site ?? null
  const renders30 = data?.stats?.rendersLast30Days ?? 0
  const notFound = !!error && /(^|\D)404(\D|$)/.test(error.message)

  useEffect(() => {
    if (error && !notFound) message.error('Could not load this site')
  }, [error, notFound])

  // Hydrate the settings form once the site loads (and on id change).
  useEffect(() => {
    if (!site) return
    form.setFieldsValue({
      name: site.name ?? '',
      status: site.status,
      integration_type: site.integration_type ?? undefined,
    })
  }, [site, form])

  async function save(values: {
    name: string
    status: Site['status']
    integration_type: IntegrationType | undefined
  }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/sites/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: values.name,
          status: values.status,
          integration_type: values.integration_type ?? null,
        }),
      })
      if (res.ok) {
        message.success('Saved')
        await mutate()
      } else {
        message.error('Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' })
      if (res.ok) {
        message.success('Site deleted')
        router.push('/domain-manager')
      } else {
        message.error('Delete failed')
        setDeleting(false)
      }
    } catch {
      message.error('Delete failed')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 900 }}>
        <Skeleton active paragraph={{ rows: 6 }} />
      </div>
    )
  }

  if (notFound || !site) {
    return (
      <Result
        status="404"
        title="Site not found"
        extra={
          <Button type="primary" onClick={() => router.push('/domain-manager')} style={{ background: BRAND, borderColor: BRAND }}>
            Back to My Sites
          </Button>
        }
      />
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => router.push('/domain-manager')} style={{ paddingLeft: 0, marginBottom: 8 }}>
        My Sites
      </Button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <Space align="center">
            <Title level={3} style={{ margin: 0 }}>
              {site.name || site.domain}
            </Title>
            <Badge status={STATUS_BADGE[site.status]} text={site.status} />
          </Space>
          <div style={{ color: '#6b7280', marginTop: 2 }}>
            <GlobalOutlined /> {site.domain}
          </div>
        </div>
        <Link href="/integration-wizard">
          <Button type="primary" icon={<RocketOutlined />} style={{ background: BRAND, borderColor: BRAND }}>
            Integration Guide
          </Button>
        </Link>
      </div>

      {/* ── Stats ────────────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} md={8}>
          <Card>
            <Statistic title="Total Renders" value={site.render_count} prefix={<ThunderboltOutlined style={{ color: BRAND }} />} />
          </Card>
        </Col>
        <Col xs={12} md={8}>
          <Card>
            <Statistic title="Renders (30 days)" value={renders30} prefix={<CalendarOutlined style={{ color: BRAND }} />} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card>
            <Text type="secondary" style={{ fontSize: 14 }}>
              Integration
            </Text>
            <div style={{ marginTop: 8 }}>
              {site.integration_type ? (
                <Tag color="blue" style={{ fontSize: 14, padding: '2px 10px' }}>
                  {INTEGRATION_LABEL[site.integration_type]}
                </Tag>
              ) : (
                <Tag>Not set</Tag>
              )}
            </div>
          </Card>
        </Col>
      </Row>

      {/* ── Settings ─────────────────────────────────────────────────────────── */}
      <Card title="Site Settings">
        <Form form={form} layout="vertical" onFinish={save} style={{ maxWidth: 460 }}>
          <Form.Item name="name" label="Site name" rules={[{ required: true, message: 'Enter a name' }]}>
            <Input placeholder="My Website" />
          </Form.Item>
          <Form.Item name="status" label="Status">
            <Select
              options={[
                { value: 'active', label: 'Active' },
                { value: 'pending', label: 'Pending' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </Form.Item>
          <Form.Item name="integration_type" label="Integration method">
            <Select
              allowClear
              placeholder="Choose how this site is integrated"
              options={[
                { value: 'worker', label: 'Cloudflare Worker' },
                { value: 'middleware', label: 'Next.js / Vercel Middleware' },
                { value: 'script', label: 'Universal (Node / PHP)' },
                { value: 'nginx', label: 'Nginx / Apache' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={saving} style={{ background: BRAND, borderColor: BRAND }}>
            Save Changes
          </Button>
        </Form>
      </Card>

      {/* ── Advanced settings ────────────────────────────────────────────────── */}
      <SiteAdvancedSettings siteId={site.id} initial={site.settings} onSaved={() => mutate()} />

      {/* ── Danger zone ──────────────────────────────────────────────────────── */}
      <Card title="Danger Zone" style={{ marginTop: 20, borderColor: '#ffccc7' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <Text type="secondary">Deleting removes this site, its cache and all its analytics. This cannot be undone.</Text>
          <Popconfirm
            title="Delete this site?"
            description="Cache and analytics will be permanently removed."
            onConfirm={remove}
            okText="Delete"
            okButtonProps={{ danger: true }}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleting}>
              Delete site
            </Button>
          </Popconfirm>
        </div>
      </Card>
    </div>
  )
}
