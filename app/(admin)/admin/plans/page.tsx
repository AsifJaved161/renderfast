'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Row,
  Col,
  Card,
  Button,
  Tag,
  Switch,
  Modal,
  Form,
  Input,
  InputNumber,
  Checkbox,
  Table,
  Typography,
  Space,
  Popconfirm,
  Alert,
  message,
} from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, CopyOutlined, MinusCircleOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography

interface Plan {
  id: string
  name: string
  slug: string
  price_monthly: number
  render_limit: number
  site_limit: number
  cache_size_gb: number
  is_active: boolean
  stripe_price_id: string | null
  features: string[] | null
  sort_order: number
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

export default function AdminPlansPage() {
  const [loading, setLoading] = useState(true)
  const [plans, setPlans] = useState<Plan[]>([])
  const [userCounts, setUserCounts] = useState<Record<string, number>>({})
  const [topPlans, setTopPlans] = useState<{ plan: string; user_count: number; percentage: number }[]>([])
  const [editing, setEditing] = useState<Plan | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [p, s] = await Promise.all([
        fetch('/api/admin/plans').then((r) => r.json()),
        fetch('/api/admin/stats').then((r) => r.json()),
      ])
      setPlans(p.plans ?? [])
      const counts: Record<string, number> = {}
      for (const tp of s.top_plans ?? []) counts[tp.plan] = tp.user_count
      setUserCounts(counts)
      setTopPlans(s.top_plans ?? [])
    } catch {
      message.error('Failed to load plans')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function toggleActive(plan: Plan, active: boolean) {
    const res = await fetch(`/api/admin/plans/${plan.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_active: active }),
    })
    if (res.ok) {
      message.success(active ? 'Plan activated' : 'Plan deactivated')
      await load()
    } else message.error('Update failed')
  }

  async function deletePlan(plan: Plan) {
    const res = await fetch(`/api/admin/plans/${plan.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (res.ok) {
      message.success('Plan deactivated')
      await load()
    } else {
      message.error(data.error ?? 'Cannot delete plan')
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    message.success('Copied')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Title level={3} style={{ color: '#fff', margin: 0 }}>
          Plan Management
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)} style={{ background: BRAND, borderColor: BRAND }}>
          Create New Plan
        </Button>
      </div>

      {/* ── Plan cards ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]}>
        {plans.map((plan) => {
          const count = userCounts[plan.slug] ?? 0
          return (
            <Col xs={24} sm={12} lg={6} key={plan.id}>
              <Card loading={loading}>
                <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                  <Title level={4} style={{ margin: 0, color: '#fff' }}>
                    {plan.name}
                  </Title>
                  <Tag>{plan.slug}</Tag>
                </Space>
                <div style={{ margin: '12px 0' }}>
                  <Text style={{ fontSize: 28, fontWeight: 700, color: BRAND }}>${plan.price_monthly}</Text>
                  <Text type="secondary">/mo</Text>
                </div>
                <ul style={{ paddingLeft: 16, color: '#bbb', fontSize: 13, lineHeight: 1.8 }}>
                  <li>{plan.render_limit.toLocaleString()} renders</li>
                  <li>{plan.site_limit === -1 ? 'Unlimited' : plan.site_limit} sites</li>
                  <li>{plan.cache_size_gb} GB cache</li>
                  <li>{count} active users</li>
                </ul>
                {plan.stripe_price_id && (
                  <div style={{ fontSize: 12, color: '#888', marginBottom: 8 }}>
                    <Text type="secondary">{plan.stripe_price_id.slice(0, 10)}••••</Text>
                    <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copy(plan.stripe_price_id!)} />
                  </div>
                )}
                <Space style={{ justifyContent: 'space-between', width: '100%', marginTop: 8 }}>
                  <Switch
                    checked={plan.is_active}
                    onChange={(v) => toggleActive(plan, v)}
                    checkedChildren="Active"
                    unCheckedChildren="Inactive"
                  />
                  <Space>
                    <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(plan)} />
                    <Popconfirm
                      title={count > 0 ? `${count} users on this plan` : 'Deactivate this plan?'}
                      onConfirm={() => deletePlan(plan)}
                      okButtonProps={{ danger: true }}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} disabled={count > 0} />
                    </Popconfirm>
                  </Space>
                </Space>
              </Card>
            </Col>
          )
        })}
      </Row>

      {/* ── Subscriptions by plan ───────────────────────────────────────────── */}
      <Card title={<span style={{ color: '#fff' }}>Active Subscriptions by Plan</span>} style={{ marginTop: 24 }}>
        <Table
          rowKey="plan"
          pagination={false}
          dataSource={topPlans}
          columns={[
            { title: 'Plan', dataIndex: 'plan', render: (p: string) => <Tag>{p}</Tag> },
            { title: 'Users Count', dataIndex: 'user_count' },
            {
              title: 'MRR Contribution',
              render: (_, row) => {
                const plan = plans.find((p) => p.slug === row.plan)
                return `$${((plan?.price_monthly ?? 0) * row.user_count).toLocaleString()}`
              },
            },
            { title: '% of Total Users', dataIndex: 'percentage', render: (v: number) => `${v}%` },
          ]}
        />
      </Card>

      {/* ── Create / Edit modals ────────────────────────────────────────────── */}
      <PlanFormModal open={createOpen} onClose={() => setCreateOpen(false)} onSaved={load} />
      <PlanFormModal open={!!editing} plan={editing} onClose={() => setEditing(null)} onSaved={load} />
    </div>
  )
}

// ── Shared create/edit modal ─────────────────────────────────────────────────
function PlanFormModal({
  open,
  plan,
  onClose,
  onSaved,
}: {
  open: boolean
  plan?: Plan | null
  onClose: () => void
  onSaved: () => void
}) {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const isEdit = !!plan

  useEffect(() => {
    if (!open) return
    if (plan) {
      form.setFieldsValue({ ...plan, features: plan.features ?? [] })
    } else {
      form.resetFields()
      form.setFieldsValue({ is_active: true, site_limit: 1, cache_size_gb: 0, sort_order: 0, features: [] })
    }
  }, [open, plan, form])

  async function submit() {
    const values = await form.validateFields()
    setSaving(true)
    try {
      const url = isEdit ? `/api/admin/plans/${plan!.id}` : '/api/admin/plans'
      const res = await fetch(url, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Save failed')
        return
      }
      message.success(isEdit ? 'Plan updated' : 'Plan created')
      onClose()
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit ${plan?.name}` : 'Create New Plan'}
      onCancel={onClose}
      onOk={submit}
      confirmLoading={saving}
      okText={isEdit ? 'Save' : 'Create'}
      okButtonProps={{ style: { background: BRAND, borderColor: BRAND } }}
      width={560}
    >
      {isEdit && (
        <Alert
          type="warning"
          showIcon
          message="Changing render_limit will affect all users on this plan"
          style={{ marginBottom: 16 }}
        />
      )}
      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="name" label="Plan Name" rules={[{ required: true }]}>
              <Input
                onChange={(e) => {
                  if (!isEdit) form.setFieldValue('slug', slugify(e.target.value))
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="slug" label="Slug" rules={[{ required: true }]}>
              <Input disabled={isEdit} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={8}>
            <Form.Item name="price_monthly" label="Price/mo ($)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="render_limit" label="Render Limit" rules={[{ required: true }]}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item name="site_limit" label="Site Limit (-1 = ∞)" rules={[{ required: true }]}>
              <InputNumber min={-1} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="cache_size_gb" label="Cache Size (GB)" rules={[{ required: true }]}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="sort_order" label="Sort Order">
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="stripe_price_id" label="Stripe Price ID (optional)">
          <Input placeholder="price_..." />
        </Form.Item>

        {/* Dynamic features list */}
        <Text strong>Features</Text>
        <Form.List name="features">
          {(fields, { add, remove }) => (
            <div style={{ marginTop: 8 }}>
              {fields.map((field) => (
                <Space key={field.key} style={{ display: 'flex', marginBottom: 8 }} align="baseline">
                  <Form.Item {...field} noStyle>
                    <Input placeholder="Feature description" style={{ width: 380 }} />
                  </Form.Item>
                  <MinusCircleOutlined onClick={() => remove(field.name)} style={{ color: '#ff4d4f' }} />
                </Space>
              ))}
              <Button type="dashed" block icon={<PlusOutlined />} onClick={() => add()}>
                Add Feature
              </Button>
            </div>
          )}
        </Form.List>

        <Form.Item name="is_active" label="Active" valuePropName="checked" style={{ marginTop: 16 }}>
          <Switch />
        </Form.Item>

        {isEdit && (
          <Form.Item name="apply_to_users" valuePropName="checked">
            <Checkbox>Apply new render_limit to all existing users on this plan</Checkbox>
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
