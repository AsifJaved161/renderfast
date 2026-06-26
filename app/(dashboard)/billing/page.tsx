'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
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

interface Invoice {
  id: string
  date: string | null
  amount: number
  currency: string
  status: string
  url: string | null
}
interface InvoiceData {
  invoices: Invoice[]
  upcoming: { amount: number; currency: string; date: string | null } | null
}

const STATUS_COLOR: Record<string, string> = {
  paid: 'green',
  open: 'blue',
  draft: 'default',
  void: 'default',
  uncollectible: 'red',
}

const money = (amount: number, currency: string) =>
  amount.toLocaleString(undefined, { style: 'currency', currency })

export default function BillingPage() {
  const [busy, setBusy] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Plan + usage via SWR (both cached, instant on revisit).
  const { data: me, isLoading: loadingMe } = useSWR<{ user?: { plan?: PlanKey } }>('/api/auth/me')
  const { data: analytics, isLoading: loadingAnalytics } = useSWR<{
    usageStats?: { renderCount: number; renderLimit: number; percentUsed: number; resetAt: string }
    renderTrend?: { date: string; renders: number }[]
  }>('/api/analytics')
  // Real invoices from Stripe (cached).
  const { data: invoiceData, isLoading: loadingInvoices } = useSWR<InvoiceData>('/api/billing/invoices')
  const invoices = invoiceData?.invoices ?? []
  const upcoming = invoiceData?.upcoming ?? null
  // Per-site render usage this billing period.
  const { data: usageData, isLoading: loadingUsage } = useSWR<{
    total: number
    sites: { siteId: string; domain: string; name: string | null; renders: number }[]
  }>('/api/billing/usage-by-site')
  const siteUsage = usageData?.sites ?? []
  const usageTotal = usageData?.total ?? 0

  const loading = loadingMe || loadingAnalytics
  const plan: PlanKey = me?.user?.plan ?? 'free'
  const usage = analytics?.usageStats ?? { renderCount: 0, renderLimit: 1000, percentUsed: 0, resetAt: '' }
  const trend = analytics?.renderTrend ?? []

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

      {/* ── Renders by site (this billing period) ───────────────────────────── */}
      <Card title="Renders by Site (this month)" style={{ marginBottom: 24 }}>
        <Table<{ siteId: string; domain: string; name: string | null; renders: number }>
          rowKey="siteId"
          loading={loadingUsage}
          pagination={false}
          dataSource={siteUsage}
          locale={{ emptyText: 'No renders yet this period.' }}
          columns={[
            {
              title: 'Site',
              dataIndex: 'domain',
              render: (_, r) => (
                <span>
                  <Text strong>{r.name || r.domain}</Text>
                  {r.name && <Text type="secondary" style={{ marginLeft: 8 }}>{r.domain}</Text>}
                </span>
              ),
            },
            {
              title: 'Renders',
              dataIndex: 'renders',
              width: 140,
              align: 'right',
              render: (v: number) => v.toLocaleString(),
            },
            {
              title: 'Share',
              width: 100,
              align: 'right',
              render: (_, r) => (usageTotal > 0 ? `${Math.round((r.renders / usageTotal) * 100)}%` : '0%'),
            },
          ]}
          summary={() =>
            siteUsage.length > 0 ? (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><Text strong>Total</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right"><Text strong>{usageTotal.toLocaleString()}</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={2} align="right"><Text strong>100%</Text></Table.Summary.Cell>
              </Table.Summary.Row>
            ) : null
          }
        />
      </Card>

      {/* ── Invoice history ─────────────────────────────────────────────────── */}
      <Card
        title="Invoice History"
        extra={
          upcoming ? (
            <Text type="secondary">
              Next: {money(upcoming.amount, upcoming.currency)}
              {upcoming.date && mounted ? ` on ${new Date(upcoming.date).toLocaleDateString()}` : ''}
            </Text>
          ) : undefined
        }
      >
        <Table<Invoice>
          rowKey="id"
          loading={loadingInvoices}
          pagination={false}
          dataSource={invoices}
          locale={{ emptyText: 'No invoices yet — they appear here after your first paid charge.' }}
          columns={[
            { title: 'Invoice #', dataIndex: 'id' },
            {
              title: 'Date',
              dataIndex: 'date',
              render: (v: string | null) => (v && mounted ? new Date(v).toLocaleDateString() : '—'),
            },
            {
              title: 'Amount',
              dataIndex: 'amount',
              render: (v: number, r) => money(v, r.currency),
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => (
                <Tag color={STATUS_COLOR[s] ?? 'default'} style={{ textTransform: 'capitalize' }}>
                  {s}
                </Tag>
              ),
            },
            {
              title: 'Invoice',
              render: (_, r) =>
                r.url ? (
                  <a href={r.url} target="_blank" rel="noopener noreferrer">
                    View / Download
                  </a>
                ) : (
                  <Text type="secondary">—</Text>
                ),
            },
          ]}
        />
      </Card>
    </div>
  )
}
