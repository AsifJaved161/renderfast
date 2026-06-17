'use client'

import { useState, useEffect } from 'react'
import {
  Row,
  Col,
  Card,
  Tag,
  Progress,
  Button,
  Table,
  Typography,
  List,
  Space,
  Skeleton,
  message,
} from 'antd'
import { CheckOutlined, CrownFilled } from '@ant-design/icons'
import { LineChart } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Title, Text } = Typography

type PlanKey = 'free' | 'starter' | 'pro' | 'agency'

interface PlanDef {
  key: PlanKey
  name: string
  price: string
  renders: string
  sites: string
  support: string
  popular?: boolean
}

const PLANS: PlanDef[] = [
  { key: 'free', name: 'Free', price: '$0', renders: '1K renders', sites: '1 site', support: 'Community support' },
  { key: 'starter', name: 'Starter', price: '$9', renders: '25K renders', sites: '3 sites', support: 'Email support' },
  { key: 'pro', name: 'Pro', price: '$29', renders: '200K renders', sites: '10 sites', support: 'Priority support', popular: true },
  { key: 'agency', name: 'Agency', price: '$79', renders: '1M renders', sites: 'Unlimited sites', support: 'Dedicated support' },
]

const INVOICES = [
  { id: 'INV-1004', date: '2026-06-01', amount: '$29.00', status: 'Paid' },
  { id: 'INV-1003', date: '2026-05-01', amount: '$29.00', status: 'Paid' },
  { id: 'INV-1002', date: '2026-04-01', amount: '$29.00', status: 'Paid' },
  { id: 'INV-1001', date: '2026-03-01', amount: '$9.00', status: 'Paid' },
]

export default function BillingPage() {
  const [loading, setLoading] = useState(true)
  const [plan, setPlan] = useState<PlanKey>('free')
  const [usage, setUsage] = useState({ renderCount: 0, renderLimit: 1000, percentUsed: 0, resetAt: '' })
  const [trend, setTrend] = useState<{ date: string; renders: number }[]>([])
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const [me, analytics] = await Promise.all([
          fetch('/api/auth/me').then((r) => r.json()),
          fetch('/api/analytics').then((r) => r.json()),
        ])
        if (me.user?.plan) setPlan(me.user.plan)
        if (analytics.usageStats) setUsage(analytics.usageStats)
        if (analytics.renderTrend) setTrend(analytics.renderTrend)
      } catch {
        // keep defaults
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function manageSubscription() {
    setBusy('portal')
    try {
      const res = await fetch('/api/billing/portal', { method: 'POST' })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else message.error(data.error ?? 'Unable to open portal')
    } catch {
      message.error('Network error')
    } finally {
      setBusy(null)
    }
  }

  async function upgrade(target: PlanKey) {
    setBusy(target)
    try {
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: target }),
      })
      const data = await res.json()
      if (data.url) window.location.href = data.url
      else message.error(data.error ?? 'Unable to start checkout')
    } catch {
      message.error('Network error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Billing</Title>

      {/* ── Current plan ────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 24 }}>
        {loading ? (
          <Skeleton active paragraph={{ rows: 2 }} />
        ) : (
          <Row align="middle" gutter={24}>
            <Col flex="auto">
              <Space>
                <Text strong style={{ fontSize: 18 }}>
                  Current Plan
                </Text>
                <Tag color={BRAND} style={{ textTransform: 'capitalize' }}>
                  {plan}
                </Tag>
              </Space>
              <div style={{ marginTop: 12, maxWidth: 480 }}>
                <Text>
                  {usage.renderCount.toLocaleString()} / {usage.renderLimit.toLocaleString()} renders
                </Text>
                <Progress
                  percent={usage.percentUsed}
                  strokeColor={usage.percentUsed > 80 ? '#ff4d4f' : BRAND}
                />
                {usage.resetAt && (
                  <Text type="secondary">
                    Next billing date: {new Date(usage.resetAt).toLocaleDateString()}
                  </Text>
                )}
              </div>
            </Col>
            <Col>
              <Button loading={busy === 'portal'} onClick={manageSubscription}>
                Manage Subscription
              </Button>
            </Col>
          </Row>
        )}
      </Card>

      {/* ── Plans grid ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {PLANS.map((p) => {
          const isCurrent = p.key === plan
          return (
            <Col xs={24} md={12} lg={6} key={p.key}>
              <Card
                style={{
                  borderColor: isCurrent ? BRAND : undefined,
                  borderWidth: isCurrent ? 2 : 1,
                  position: 'relative',
                  height: '100%',
                }}
              >
                {p.popular && (
                  <Tag
                    color={BRAND}
                    icon={<CrownFilled />}
                    style={{ position: 'absolute', top: 12, right: 12 }}
                  >
                    Most Popular
                  </Tag>
                )}
                <Title level={4} style={{ marginBottom: 0 }}>
                  {p.name}
                </Title>
                <div style={{ margin: '8px 0' }}>
                  <Text strong style={{ fontSize: 28 }}>
                    {p.price}
                  </Text>
                  <Text type="secondary">/mo</Text>
                </div>
                <List
                  size="small"
                  split={false}
                  dataSource={[p.renders, p.sites, p.support]}
                  renderItem={(item) => (
                    <List.Item style={{ padding: '4px 0' }}>
                      <Space>
                        <CheckOutlined style={{ color: BRAND }} />
                        {item}
                      </Space>
                    </List.Item>
                  )}
                />
                <div style={{ marginTop: 16 }}>
                  {isCurrent ? (
                    <Button block disabled>
                      Current Plan
                    </Button>
                  ) : p.key === 'free' ? (
                    <Button block onClick={manageSubscription} loading={busy === 'portal'}>
                      Downgrade
                    </Button>
                  ) : (
                    <Button
                      block
                      type="primary"
                      loading={busy === p.key}
                      onClick={() => upgrade(p.key)}
                      style={{ background: BRAND, borderColor: BRAND }}
                    >
                      Upgrade
                    </Button>
                  )}
                </div>
              </Card>
            </Col>
          )
        })}
      </Row>

      {/* ── Usage chart ─────────────────────────────────────────────────────── */}
      <Card title="Render Usage (last 30 days)" style={{ marginBottom: 24 }}>
        {loading ? (
          <Skeleton active />
        ) : (
          <LineChart
            labels={trend.map((t) => t.date.slice(5))}
            series={[{ label: 'Renders', color: BRAND, points: trend.map((t) => t.renders) }]}
            fill
          />
        )}
      </Card>

      {/* ── Invoice history ─────────────────────────────────────────────────── */}
      <Card title="Invoice History">
        <Table
          rowKey="id"
          pagination={false}
          dataSource={INVOICES}
          columns={[
            { title: 'Invoice #', dataIndex: 'id' },
            { title: 'Date', dataIndex: 'date' },
            { title: 'Amount', dataIndex: 'amount' },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => <Tag color="green">{s}</Tag>,
            },
            {
              title: 'Invoice',
              render: () => (
                <a href="#" onClick={(e) => e.preventDefault()}>
                  Download PDF
                </a>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
