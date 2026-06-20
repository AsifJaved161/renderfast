'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Row,
  Col,
  Card,
  InputNumber,
  Input,
  Button,
  Tag,
  Space,
  Statistic,
  Table,
  Typography,
  Skeleton,
  Alert,
  message,
} from 'antd'
import { DollarOutlined, SaveOutlined, HistoryOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

interface CurrentRate {
  rate_per_gb_usd: number
  rate_source: string
  effective_from: string
}
interface HistoryRow {
  id: string
  rate_per_gb_usd: number
  effective_from: string
  effective_to: string | null
  set_by: string | null
  created_at: string
}
interface RateData {
  current: CurrentRate
  history: HistoryRow[]
}

// Admin-only bandwidth $/GB rate configuration. Access is enforced at THREE
// layers (see notes at the bottom of this file): middleware page gate, the
// admin layout's is_admin check, and — the real lock — requireAdmin() on the
// /api/admin/bot-cost endpoints this page calls. A non-admin hitting the API
// directly gets 403, so the rate is never readable or writable by clients.
export default function AdminBotCostPage() {
  const [data, setData] = useState<RateData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [rate, setRate] = useState<number | null>(null)
  const [source, setSource] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/bot-cost')
      if (!res.ok) throw new Error(String(res.status))
      const d: RateData = await res.json()
      setData(d)
      setRate(d.current.rate_per_gb_usd)
      setSource(d.current.rate_source)
    } catch {
      message.error('Failed to load rate configuration')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (rate == null || !Number.isFinite(rate) || rate < 0) {
      message.error('Enter a valid rate (≥ 0)')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/bot-cost', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rate_per_gb_usd: rate, rate_source: source || undefined }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        message.error(e.error ?? 'Save failed')
        return
      }
      const d = await res.json()
      message.success(d.updated ? 'New rate applied (history updated)' : 'Saved (rate unchanged)')
      setData({ current: d.current, history: d.history })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />

  const current = data?.current
  const changed = rate != null && current != null && Number(rate) !== Number(current.rate_per_gb_usd)

  return (
    <div style={{ maxWidth: 1000 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <Space>
          <DollarOutlined style={{ color: BRAND }} /> Bandwidth Cost Rate
        </Space>
      </Title>
      <Paragraph type="secondary">
        The estimated <b>$/GB bandwidth rate</b> used to translate bot traffic into an estimated
        dollar figure shown to clients. Changing it never rewrites the past — each historical
        record keeps the rate that was active at the time, so prior months’ estimates stay stable.
      </Paragraph>

      <Row gutter={[16, 16]}>
        {/* ── Current + edit ────────────────────────────────────────────────── */}
        <Col xs={24} lg={12}>
          <Card title="Current rate">
            <Statistic
              value={current?.rate_per_gb_usd ?? 0}
              prefix="$"
              suffix="/GB"
              precision={4}
              valueStyle={{ color: BRAND }}
            />
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">{current?.rate_source}</Text>
            </div>
            <div style={{ marginTop: 4 }}>
              <Tag color="green">active since {current?.effective_from}</Tag>
            </div>
          </Card>

          <Card title={<Space><SaveOutlined /> Set a new rate</Space>} style={{ marginTop: 16 }}>
            <Text>Rate ($ per GB)</Text>
            <InputNumber
              min={0}
              step={0.01}
              value={rate ?? undefined}
              onChange={(v) => setRate(v)}
              addonBefore="$"
              addonAfter="/GB"
              style={{ width: '100%', marginTop: 4, marginBottom: 14 }}
            />

            <Text>Source / label</Text>
            <Input
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="e.g. Industry average estimate ($0.05–0.12/GB)"
              style={{ marginTop: 4, marginBottom: 14 }}
            />

            {changed && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 14 }}
                message="This closes the current rate period and starts a new one"
                description="A new history record is inserted with effective_from = today; the previous record’s effective_to is set to today. Past estimates are unaffected."
              />
            )}

            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={save}
              style={{ background: BRAND, borderColor: BRAND }}
            >
              Save rate
            </Button>
          </Card>
        </Col>

        {/* ── History ───────────────────────────────────────────────────────── */}
        <Col xs={24} lg={12}>
          <Card title={<Space><HistoryOutlined /> Rate history</Space>}>
            <Table<HistoryRow>
              size="small"
              rowKey="id"
              pagination={false}
              dataSource={data?.history ?? []}
              columns={[
                {
                  title: 'Rate',
                  dataIndex: 'rate_per_gb_usd',
                  render: (v: number) => <strong>${Number(v).toFixed(4)}/GB</strong>,
                },
                {
                  title: 'Effective from',
                  dataIndex: 'effective_from',
                },
                {
                  title: 'Effective to',
                  dataIndex: 'effective_to',
                  render: (v: string | null) =>
                    v ? v : <Tag color="green">active</Tag>,
                },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
