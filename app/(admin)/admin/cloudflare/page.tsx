'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Row,
  Col,
  Card,
  Progress,
  Statistic,
  InputNumber,
  Button,
  Typography,
  Space,
  Skeleton,
  Alert,
  Divider,
  Tag,
  message,
} from 'antd'
import {
  CloudServerOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  SaveOutlined,
  ReloadOutlined,
  RiseOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography
const GB = 1_000_000_000

interface Usage {
  renders: { today: number; month: number; all: number }
  kv: { keys: number; bytes: number; readsToday: number; writesToday: number }
  totalSites: number
}
interface Limits {
  renderMonth: number
  kvStorageGb: number
  kvReadsDay: number
  kvWritesDay: number
}
interface Derived {
  renderMonthPct: number
  renderMonthRemaining: number
  kvStoragePct: number
  kvStorageRemainingBytes: number
  kvReadsPct: number
  kvWritesPct: number
  avgRendersPerSite: number
  estSitesRemaining: number | null
}
interface Data {
  usage: Usage
  limits: Limits
  derived: Derived
}

const n = (x: number) => x.toLocaleString()
function fmtBytes(b: number): string {
  if (b >= GB) return `${(b / GB).toFixed(2)} GB`
  if (b >= 1_000_000) return `${(b / 1_000_000).toFixed(1)} MB`
  if (b >= 1_000) return `${(b / 1_000).toFixed(1)} KB`
  return `${b} B`
}
const barColor = (p: number) => (p >= 90 ? '#ff4d4f' : p >= 70 ? '#faad14' : BRAND)

export default function AdminCloudflarePage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<Limits | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/cloudflare-usage')
      if (!res.ok) throw new Error(String(res.status))
      const d: Data = await res.json()
      setData(d)
      setForm(d.limits)
    } catch {
      message.error('Failed to load Cloudflare usage')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function saveLimits() {
    if (!form) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/cloudflare-usage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        message.error(e.error ?? 'Save failed')
        return
      }
      message.success('Plan limits saved')
      load()
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />
  if (!data || !form) return <Card>Failed to load Cloudflare usage.</Card>

  const { usage, derived } = data

  return (
    <div style={{ maxWidth: 1100 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <Space>
          <CloudServerOutlined style={{ color: BRAND }} /> Cloudflare Resources
        </Space>
      </Title>
      <Paragraph type="secondary">
        How much of your Cloudflare quota RenderFast has consumed — Browser Rendering calls and
        Workers KV — and how much is left. Set your plan’s limits below; everything is computed from
        our own records (no per-client Cloudflare calls), so it stays accurate at any scale.
      </Paragraph>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ReloadOutlined />} onClick={load}>
          Refresh
        </Button>
      </Space>

      {/* ── Capacity estimate (scale planning) ──────────────────────────────── */}
      <Alert
        type={derived.renderMonthPct >= 90 ? 'warning' : 'info'}
        showIcon
        icon={<RiseOutlined />}
        style={{ marginBottom: 16 }}
        message="Capacity"
        description={
          <span>
            Currently serving <strong>{n(usage.totalSites)}</strong> sites at ~
            <strong>{n(derived.avgRendersPerSite)}</strong> renders/site this month.{' '}
            {derived.estSitesRemaining == null ? (
              'Add traffic to estimate remaining capacity.'
            ) : (
              <>
                Remaining monthly render budget can support roughly{' '}
                <strong>{n(derived.estSitesRemaining)}</strong> more sites at the current average.
              </>
            )}
          </span>
        }
      />

      {/* ── Usage bars ──────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<Space><ThunderboltOutlined /> Browser Rendering (monthly)</Space>}>
            <Progress percent={derived.renderMonthPct} strokeColor={barColor(derived.renderMonthPct)} />
            <Text>
              {n(usage.renders.month)} / {n(form.renderMonth)} calls used
            </Text>
            <div>
              <Text type="secondary">{n(derived.renderMonthRemaining)} remaining · {n(usage.renders.today)} today</Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={<Space><DatabaseOutlined /> KV Storage</Space>}>
            <Progress percent={derived.kvStoragePct} strokeColor={barColor(derived.kvStoragePct)} />
            <Text>
              {fmtBytes(usage.kv.bytes)} / {form.kvStorageGb} GB used
            </Text>
            <div>
              <Text type="secondary">
                {fmtBytes(derived.kvStorageRemainingBytes)} remaining · {n(usage.kv.keys)} keys (cached pages)
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={<Space><DatabaseOutlined /> KV Reads (today)</Space>}>
            <Progress percent={derived.kvReadsPct} strokeColor={barColor(derived.kvReadsPct)} />
            <Text>
              {n(usage.kv.readsToday)} / {n(form.kvReadsDay)} reads — cache hits
            </Text>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card title={<Space><DatabaseOutlined /> KV Writes (today)</Space>}>
            <Progress percent={derived.kvWritesPct} strokeColor={barColor(derived.kvWritesPct)} />
            <Text>
              {n(usage.kv.writesToday)} / {n(form.kvWritesDay)} writes — fresh renders stored
            </Text>
          </Card>
        </Col>
      </Row>

      {/* ── Totals ──────────────────────────────────────────────────────────── */}
      <Card style={{ marginTop: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}><Statistic title="Renders all-time" value={usage.renders.all} /></Col>
          <Col xs={12} lg={6}><Statistic title="Cached pages (KV keys)" value={usage.kv.keys} /></Col>
          <Col xs={12} lg={6}><Statistic title="KV storage" value={fmtBytes(usage.kv.bytes)} /></Col>
          <Col xs={12} lg={6}><Statistic title="Total sites" value={usage.totalSites} /></Col>
        </Row>
      </Card>

      {/* ── Editable plan limits ────────────────────────────────────────────── */}
      <Card title="Your Cloudflare plan limits" style={{ marginTop: 16 }}>
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          Defaults are Cloudflare’s free tier. Set these to your actual plan so “used vs remaining”
          and the capacity estimate are accurate.
        </Paragraph>
        <Row gutter={[16, 16]}>
          <Col xs={12} lg={6}>
            <Text>Browser Rendering / month</Text>
            <InputNumber min={1} style={{ width: '100%' }} value={form.renderMonth} onChange={(v) => setForm({ ...form, renderMonth: v ?? 1 })} />
          </Col>
          <Col xs={12} lg={6}>
            <Text>KV storage (GB)</Text>
            <InputNumber min={0.1} step={0.5} style={{ width: '100%' }} value={form.kvStorageGb} onChange={(v) => setForm({ ...form, kvStorageGb: v ?? 1 })} />
          </Col>
          <Col xs={12} lg={6}>
            <Text>KV reads / day</Text>
            <InputNumber min={1} style={{ width: '100%' }} value={form.kvReadsDay} onChange={(v) => setForm({ ...form, kvReadsDay: v ?? 1 })} />
          </Col>
          <Col xs={12} lg={6}>
            <Text>KV writes / day</Text>
            <InputNumber min={1} style={{ width: '100%' }} value={form.kvWritesDay} onChange={(v) => setForm({ ...form, kvWritesDay: v ?? 1 })} />
          </Col>
        </Row>
        <Divider style={{ margin: '16px 0' }} />
        <Space align="center">
          <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveLimits} style={{ background: BRAND, borderColor: BRAND }}>
            Save limits
          </Button>
          <Tag color="default">KV storage is an approximate ceiling (uncompressed); actual KV usage is lower</Tag>
        </Space>
      </Card>
    </div>
  )
}
