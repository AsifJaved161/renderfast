'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Button,
  Modal,
  Form,
  Input,
  Tag,
  Badge,
  Popconfirm,
  Drawer,
  Empty,
  Statistic,
  Typography,
  Space,
  Select,
  message,
} from 'antd'
import {
  PlusOutlined,
  GlobalOutlined,
  SettingOutlined,
  DeleteOutlined,
} from '@ant-design/icons'
const BRAND = '#2da01d'
const { Title, Text } = Typography

interface Site {
  id: string
  domain: string
  name: string | null
  status: 'active' | 'pending' | 'inactive'
  integration_type: 'dns' | 'middleware' | 'wordpress' | null
  render_count: number
}

const STATUS_BADGE: Record<Site['status'], 'success' | 'warning' | 'default'> = {
  active: 'success',
  pending: 'warning',
  inactive: 'default',
}

const INTEGRATION_LABEL: Record<string, string> = {
  dns: 'DNS',
  middleware: 'Middleware',
  wordpress: 'WordPress',
}

export default function DomainManagerPage() {
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState<Site[]>([])
  const [limit, setLimit] = useState<number | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [adding, setAdding] = useState(false)
  const [settingsSite, setSettingsSite] = useState<Site | null>(null)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/sites')
      const json = await res.json()
      setSites(json.sites ?? [])
      setLimit(json.limit ?? null)
    } catch {
      message.error('Failed to load domains')
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
        message.error(data.error ?? 'Failed to add domain')
        return
      }
      message.success('Domain added')
      setAddOpen(false)
      form.resetFields()
      await load()
    } finally {
      setAdding(false)
    }
  }

  async function deleteSite(id: string) {
    const res = await fetch(`/api/sites/${id}`, { method: 'DELETE' })
    if (res.ok) {
      message.success('Domain deleted')
      await load()
    } else {
      message.error('Delete failed')
    }
  }

  const usageText =
    limit === null ? `Using ${sites.length} websites` : `Using ${sites.length} of ${limit} websites`

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
        <div>
          <Title level={3} style={{ margin: 0 }}>
            My Domains
          </Title>
          <Text type="secondary">{usageText}</Text>
        </div>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => setAddOpen(true)}
          style={{ background: BRAND, borderColor: BRAND }}
          disabled={limit !== null && sites.length >= limit}
        >
          Add Domain
        </Button>
      </div>

      {/* ── Domain grid / empty state ───────────────────────────────────────── */}
      {!loading && sites.length === 0 ? (
        <Card>
          <Empty
            image={<GlobalOutlined style={{ fontSize: 64, color: '#d9d9d9' }} />}
            description="No domains yet"
          >
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
              style={{ background: BRAND, borderColor: BRAND }}
            >
              Add your first domain
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {sites.map((site) => (
            <Col xs={24} lg={12} key={site.id}>
              <Card loading={loading}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <Space>
                      <Text strong style={{ fontSize: 16 }}>
                        {site.domain}
                      </Text>
                      <Badge status={STATUS_BADGE[site.status]} text={site.status} />
                    </Space>
                    <div style={{ marginTop: 6 }}>
                      {site.integration_type ? (
                        <Tag color="blue">{INTEGRATION_LABEL[site.integration_type]}</Tag>
                      ) : (
                        <Tag>No integration</Tag>
                      )}
                    </div>
                  </div>
                </div>

                <Row gutter={16} style={{ marginTop: 16 }}>
                  <Col span={8}>
                    <Statistic title="Renders" value={site.render_count} valueStyle={{ fontSize: 18 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Cached" value={0} valueStyle={{ fontSize: 18 }} />
                  </Col>
                  <Col span={8}>
                    <Statistic title="Last Activity" value="—" valueStyle={{ fontSize: 18 }} />
                  </Col>
                </Row>

                <Space style={{ marginTop: 16 }}>
                  <Button icon={<SettingOutlined />} onClick={() => setSettingsSite(site)}>
                    Settings
                  </Button>
                  <Popconfirm
                    title="Delete this domain?"
                    description="Cache and analytics will be removed."
                    onConfirm={() => deleteSite(site.id)}
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                  >
                    <Button danger icon={<DeleteOutlined />}>
                      Delete
                    </Button>
                  </Popconfirm>
                </Space>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* ── Add domain modal ────────────────────────────────────────────────── */}
      <Modal
        title="Add Domain"
        open={addOpen}
        onCancel={() => setAddOpen(false)}
        onOk={() => form.submit()}
        confirmLoading={adding}
        okText="Add"
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
            <Input prefix={<GlobalOutlined />} placeholder="example.com" />
          </Form.Item>
          <Form.Item name="name" label="Site Name" rules={[{ required: true, message: 'Enter a name' }]}>
            <Input placeholder="My Marketing Site" />
          </Form.Item>
        </Form>
      </Modal>

      {/* ── Settings drawer ─────────────────────────────────────────────────── */}
      <Drawer
        title={settingsSite ? `Settings — ${settingsSite.domain}` : 'Settings'}
        open={!!settingsSite}
        onClose={() => setSettingsSite(null)}
        width={420}
      >
        {settingsSite && (
          <SiteSettings
            site={settingsSite}
            onSaved={async () => {
              setSettingsSite(null)
              await load()
            }}
          />
        )}
      </Drawer>
    </div>
  )
}

function SiteSettings({ site, onSaved }: { site: Site; onSaved: () => void }) {
  const [saving, setSaving] = useState(false)

  async function save(values: {
    name: string
    status: Site['status']
    integration_type: Site['integration_type']
  }) {
    setSaving(true)
    try {
      const res = await fetch(`/api/sites/${site.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      if (res.ok) {
        message.success('Saved')
        onSaved()
      } else {
        message.error('Save failed')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Form
      layout="vertical"
      onFinish={save}
      initialValues={{
        name: site.name ?? '',
        status: site.status,
        integration_type: site.integration_type ?? undefined,
      }}
    >
      <Form.Item name="name" label="Site Name">
        <Input />
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
      <Form.Item name="integration_type" label="Integration Type">
        <Select
          allowClear
          options={[
            { value: 'dns', label: 'DNS Proxy' },
            { value: 'middleware', label: 'Next.js Middleware' },
            { value: 'wordpress', label: 'WordPress Plugin' },
          ]}
        />
      </Form.Item>
      <Button
        type="primary"
        htmlType="submit"
        loading={saving}
        block
        style={{ background: BRAND, borderColor: BRAND }}
      >
        Save Changes
      </Button>
    </Form>
  )
}
