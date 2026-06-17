'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Select,
  Input,
  Tag,
  Badge,
  Dropdown,
  Button,
  Modal,
  Form,
  InputNumber,
  Row,
  Col,
  Statistic,
  Typography,
  Space,
  Popconfirm,
  message,
} from 'antd'
import { MoreOutlined, CopyOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title } = Typography

interface Subscription {
  stripe_sub_id: string
  user_email: string | null
  plan: string
  status: string
  amount: number
  next_billing: string | null
}

const PLAN_COLOR: Record<string, string> = { free: 'default', starter: 'blue', pro: 'purple', agency: 'green' }
const STATUS_COLOR: Record<string, string> = {
  active: 'green',
  canceled: 'default',
  past_due: 'red',
  trialing: 'blue',
  unpaid: 'red',
}

export default function AdminSubscriptionsPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<Subscription[]>([])
  const [status, setStatus] = useState<string | undefined>()
  const [plan, setPlan] = useState<string | undefined>()
  const [search, setSearch] = useState('')
  const [changePlanSub, setChangePlanSub] = useState<Subscription | null>(null)
  const [refundSub, setRefundSub] = useState<Subscription | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (plan) params.set('plan', plan)
      const res = await fetch(`/api/admin/subscriptions?${params}`)
      const json = await res.json()
      setRows(json.subscriptions ?? [])
    } catch {
      message.error('Failed to load subscriptions')
    } finally {
      setLoading(false)
    }
  }, [status, plan])

  useEffect(() => {
    load()
  }, [load])

  const filtered = rows.filter((s) =>
    search ? (s.user_email ?? '').toLowerCase().includes(search.toLowerCase()) : true
  )

  // Revenue summary.
  const active = rows.filter((s) => s.status === 'active')
  const mrr = active.reduce((sum, s) => sum + s.amount, 0)
  const pastDue = rows.filter((s) => s.status === 'past_due').length

  async function patchSub(subId: string, body: Record<string, unknown>, ok: string) {
    const res = await fetch(`/api/admin/subscriptions/${subId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    if (res.ok) {
      message.success(ok)
      await load()
      return true
    }
    message.error(data.error ?? 'Action failed')
    return false
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    message.success('Copied')
  }

  function rowMenu(s: Subscription) {
    return {
      items: [
        { key: 'stripe', label: 'View in Stripe' },
        { key: 'plan', label: 'Change Plan' },
        { key: 'cancel', label: 'Cancel Subscription', danger: true },
        { key: 'refund', label: 'Issue Refund' },
      ],
      onClick: ({ key }: { key: string }) => {
        if (key === 'stripe') window.open(`https://dashboard.stripe.com/subscriptions/${s.stripe_sub_id}`, '_blank')
        else if (key === 'plan') setChangePlanSub(s)
        else if (key === 'refund') setRefundSub(s)
        else if (key === 'cancel') {
          Modal.confirm({
            title: 'Cancel this subscription?',
            content: `${s.user_email} — they will be downgraded to Free.`,
            okText: 'Cancel Subscription',
            okButtonProps: { danger: true },
            onOk: () => patchSub(s.stripe_sub_id, { action: 'cancel' }, 'Subscription canceled'),
          })
        }
      },
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Title level={3} style={{ color: '#fff', margin: 0 }}>
          Subscriptions
        </Title>
        <Badge count={`MRR: $${mrr.toLocaleString()}`} style={{ backgroundColor: BRAND }} />
      </Space>

      {/* ── Revenue summary ─────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="Total Active" value={active.length} valueStyle={{ color: BRAND }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="MRR" value={mrr} prefix="$" valueStyle={{ color: BRAND }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="ARR" value={mrr * 12} prefix="$" valueStyle={{ color: BRAND }} />
          </Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card>
            <Statistic title="Past Due" value={pastDue} valueStyle={{ color: '#ff4d4f' }} suffix="accounts" />
          </Card>
        </Col>
      </Row>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            placeholder="All statuses"
            style={{ width: 150 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'canceled', label: 'Canceled' },
              { value: 'past_due', label: 'Past Due' },
            ]}
          />
          <Select
            allowClear
            placeholder="All plans"
            style={{ width: 140 }}
            value={plan}
            onChange={setPlan}
            options={['starter', 'pro', 'agency'].map((p) => ({ value: p, label: p }))}
          />
          <Input.Search placeholder="Search by email" allowClear onChange={(e) => setSearch(e.target.value)} style={{ width: 240 }} />
        </Space>
      </Card>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <Card>
        <Table<Subscription>
          loading={loading}
          rowKey="stripe_sub_id"
          dataSource={filtered}
          columns={[
            { title: 'User', dataIndex: 'user_email', render: (v: string | null) => v ?? '—' },
            { title: 'Plan', dataIndex: 'plan', width: 100, render: (p: string) => <Tag color={PLAN_COLOR[p]}>{p}</Tag> },
            {
              title: 'Status',
              dataIndex: 'status',
              width: 110,
              render: (s: string) => <Badge color={STATUS_COLOR[s] ?? 'default'} text={s} />,
            },
            { title: 'Amount', dataIndex: 'amount', width: 110, render: (a: number) => `$${a}/mo` },
            {
              title: 'Next Billing',
              dataIndex: 'next_billing',
              width: 160,
              render: (v: string | null) => (v ? new Date(v).toLocaleDateString() : '—'),
            },
            {
              title: 'Stripe Sub ID',
              dataIndex: 'stripe_sub_id',
              width: 150,
              render: (id: string) => (
                <Space>
                  <span style={{ color: '#888' }}>{id.slice(0, 10)}…</span>
                  <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => copy(id)} />
                </Space>
              ),
            },
            {
              title: '',
              width: 50,
              render: (_, s) => (
                <Dropdown menu={rowMenu(s)} trigger={['click']}>
                  <Button type="text" icon={<MoreOutlined />} />
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Change plan modal ───────────────────────────────────────────────── */}
      <ChangePlanModal
        sub={changePlanSub}
        onClose={() => setChangePlanSub(null)}
        onConfirm={async (sub, newPlan) => {
          const ok = await patchSub(sub.stripe_sub_id, { action: 'change_plan', plan: newPlan }, 'Plan changed')
          if (ok) setChangePlanSub(null)
        }}
      />

      {/* ── Refund modal ────────────────────────────────────────────────────── */}
      <RefundModal
        sub={refundSub}
        onClose={() => setRefundSub(null)}
        onConfirm={async (sub, amount) => {
          const ok = await patchSub(sub.stripe_sub_id, { action: 'refund', amount }, 'Refund issued')
          if (ok) setRefundSub(null)
        }}
      />
    </div>
  )
}

function ChangePlanModal({
  sub,
  onClose,
  onConfirm,
}: {
  sub: Subscription | null
  onClose: () => void
  onConfirm: (sub: Subscription, plan: string) => void
}) {
  const [newPlan, setNewPlan] = useState('pro')
  useEffect(() => {
    if (sub) setNewPlan(sub.plan === 'unknown' ? 'pro' : sub.plan)
  }, [sub])
  if (!sub) return null
  return (
    <Modal open title="Change Plan" onCancel={onClose} onOk={() => onConfirm(sub, newPlan)} okText="Change Plan">
      <Form layout="vertical">
        <Form.Item label="New plan (Stripe price)">
          <Select
            value={newPlan}
            onChange={setNewPlan}
            options={['starter', 'pro', 'agency'].map((p) => ({ value: p, label: p }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}

function RefundModal({
  sub,
  onClose,
  onConfirm,
}: {
  sub: Subscription | null
  onClose: () => void
  onConfirm: (sub: Subscription, amount: number) => void
}) {
  const [amount, setAmount] = useState<number>(0)
  useEffect(() => {
    if (sub) setAmount(sub.amount)
  }, [sub])
  if (!sub) return null
  return (
    <Modal open title="Issue Refund" onCancel={onClose} onOk={() => onConfirm(sub, amount)} okText="Refund" okButtonProps={{ danger: true }}>
      <Form layout="vertical">
        <Form.Item label="Refund amount ($)" help="Refunds the latest invoice for this subscription.">
          <InputNumber min={0} value={amount} onChange={(v) => setAmount(v ?? 0)} style={{ width: '100%' }} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
