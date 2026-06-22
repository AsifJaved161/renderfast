'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Row, Col, Card, Statistic, Button, Typography, Skeleton, List, Tag, Space, Divider } from 'antd'
import {
  TeamOutlined,
  DollarOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  UserAddOutlined,
  CreditCardOutlined,
  GlobalOutlined,
  StopOutlined,
  ExportOutlined,
  PlusOutlined,
  DownloadOutlined,
} from '@ant-design/icons'
import { LineChart, BarChart, DonutChart, Legend } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Title, Text } = Typography

interface Stats {
  users: { total: number; new_today: number; new_this_month: number; active_last_30d: number; banned: number }
  revenue: { mrr: number; arr: number; total_customers: number }
  renders: { total_all_time: number; today: number; this_month: number; cache_hit_rate: number }
  system: { total_sites: number; total_cached_pages: number; total_bot_visits: number }
  top_plans: { plan: string; user_count: number; percentage: number }[]
  signups_trend: { date: string; count: number }[]
  renders_trend: { date: string; count: number }[]
  revenue_trend: { date: string; amount: number }[]
}

const PLAN_COLORS: Record<string, string> = {
  free: '#8c8c8c',
  starter: '#1677ff',
  pro: '#722ed1',
  agency: BRAND,
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<Stats | null>(null)
  const [logs, setLogs] = useState<any[]>([])

  useEffect(() => {
    // Load stats and logs INDEPENDENTLY — a failure in one must not blank out the
    // other (previously a single Promise.all without a catch meant a failing
    // /api/admin/logs killed the whole dashboard with "Failed to load stats").
    fetch('/api/admin/stats')
      .then((r) => r.json())
      .then((s) => {
        if (!s.error) setStats(s)
      })
      .catch(() => {})
      .finally(() => setLoading(false))

    fetch('/api/admin/logs?limit=10')
      .then((r) => r.json())
      .then((l) => setLogs(l.logs ?? []))
      .catch(() => setLogs([]))
  }, [])

  function downloadReport() {
    if (!stats) return
    const rows = [
      ['Metric', 'Value'],
      ['Total Users', stats.users.total],
      ['New Signups (30d)', stats.users.new_this_month],
      ['Banned Users', stats.users.banned],
      ['MRR', stats.revenue.mrr],
      ['ARR', stats.revenue.arr],
      ['Active Subscriptions', stats.revenue.total_customers],
      ['Renders Today', stats.renders.today],
      ['Cache Hit Rate', `${stats.renders.cache_hit_rate}%`],
      ['Total Sites', stats.system.total_sites],
    ]
    const csv = rows.map((r) => r.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `renderfast-report-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  if (loading) return <Skeleton active paragraph={{ rows: 12 }} />
  if (!stats) return <Card>Failed to load stats.</Card>

  const planSlices = stats.top_plans.map((p) => ({
    label: p.plan,
    value: p.user_count,
    color: PLAN_COLORS[p.plan] ?? '#555',
  }))

  return (
    <div>
      <Title level={3} style={{ color: '#1f2937' }}>
        Overview
      </Title>

      {/* ── KPI Row 1 ───────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]}>
        <Kpi title="Total Users" value={stats.users.total} icon={<TeamOutlined />} />
        <Kpi title="MRR" value={stats.revenue.mrr} prefix="$" accent icon={<DollarOutlined />} />
        <Kpi title="Renders Today" value={stats.renders.today} icon={<ThunderboltOutlined />} />
        <Kpi title="Cache Hit Rate" value={stats.renders.cache_hit_rate} suffix="%" accent icon={<CheckCircleOutlined />} />
      </Row>

      {/* ── KPI Row 2 ───────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Kpi title="New Signups (30d)" value={stats.users.new_this_month} icon={<UserAddOutlined />} />
        <Kpi title="Active Subscriptions" value={stats.revenue.total_customers} icon={<CreditCardOutlined />} />
        <Kpi title="Total Sites" value={stats.system.total_sites} icon={<GlobalOutlined />} />
        <Kpi title="Banned Users" value={stats.users.banned} danger icon={<StopOutlined />} />
      </Row>

      {/* ── Revenue ─────────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col xs={24} lg={16}>
          <Card title={<span style={{ color: '#1f2937' }}>Revenue Trend (30d)</span>}>
            <Space size={48} style={{ marginBottom: 16 }}>
              <Statistic title="MRR" value={stats.revenue.mrr} prefix="$" valueStyle={{ color: BRAND }} />
              <Statistic title="ARR" value={stats.revenue.arr} prefix="$" valueStyle={{ color: BRAND }} />
            </Space>
            <LineChart
              labels={stats.revenue_trend.map((t) => t.date.slice(5))}
              series={[{ label: 'Revenue', color: BRAND, points: stats.revenue_trend.map((t) => t.amount) }]}
              unit="$"
              fill
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span style={{ color: '#1f2937' }}>Plan Distribution</span>}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
              <DonutChart data={planSlices} />
              <Legend data={planSlices} />
            </div>
          </Card>
        </Col>
      </Row>

      {/* ── Growth ──────────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title={<span style={{ color: '#1f2937' }}>User Signups (30d)</span>}>
            <BarChart data={stats.signups_trend.map((t) => ({ label: t.date.slice(5), value: t.count }))} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span style={{ color: '#1f2937' }}>Renders (30d)</span>}>
            <LineChart
              labels={stats.renders_trend.map((t) => t.date.slice(5))}
              series={[{ label: 'Renders', color: '#722ed1', points: stats.renders_trend.map((t) => t.count) }]}
              fill
            />
          </Card>
        </Col>
      </Row>

      {/* ── Quick actions + activity ────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={8}>
          <Card title={<span style={{ color: '#1f2937' }}>Quick Actions</span>}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Button block icon={<TeamOutlined />} onClick={() => router.push('/admin/users')}>
                View All Users
              </Button>
              <Button block icon={<PlusOutlined />} onClick={() => router.push('/admin/plans')}>
                Add New Plan
              </Button>
              <Button block icon={<ExportOutlined />} onClick={() => window.open('https://dashboard.stripe.com', '_blank')}>
                View Stripe Dashboard
              </Button>
              <Button block type="primary" icon={<DownloadOutlined />} onClick={downloadReport} style={{ background: BRAND, borderColor: BRAND }}>
                Download User Report CSV
              </Button>
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={16}>
          <Card title={<span style={{ color: '#1f2937' }}>Recent Activity</span>}>
            <List
              dataSource={logs}
              locale={{ emptyText: 'No admin activity yet' }}
              renderItem={(log: any) => (
                <List.Item>
                  <Space>
                    <Tag color="green">{log.action}</Tag>
                    <Text style={{ color: '#374151' }}>
                      {log.target_type ? `${log.target_type}:${log.target_id ?? ''}` : '—'}
                    </Text>
                    <Text type="secondary">by {log.admin_name}</Text>
                  </Space>
                  <Text type="secondary">{new Date(log.created_at).toLocaleString()}</Text>
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

function Kpi({
  title,
  value,
  prefix,
  suffix,
  icon,
  accent,
  danger,
}: {
  title: string
  value: number
  prefix?: string
  suffix?: string
  icon: React.ReactNode
  accent?: boolean
  danger?: boolean
}) {
  const color = danger ? '#ff4d4f' : accent ? BRAND : '#1f2937'
  return (
    <Col xs={12} lg={6}>
      <Card>
        <Statistic
          title={title}
          value={value}
          prefix={prefix}
          suffix={suffix}
          valueStyle={{ color }}
        />
        <div style={{ position: 'absolute', top: 16, right: 16, fontSize: 20, color: '#555' }}>{icon}</div>
      </Card>
    </Col>
  )
}
