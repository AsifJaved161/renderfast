'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Row,
  Col,
  Card,
  Input,
  InputNumber,
  Button,
  Tag,
  Space,
  Statistic,
  Alert,
  Typography,
  Divider,
  Skeleton,
  Switch,
  Tooltip,
  message,
} from 'antd'
import {
  CloudServerOutlined,
  ApiOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ExperimentOutlined,
  SaveOutlined,
  InfoCircleOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

interface CfField {
  key: string
  set: boolean
  source: 'db' | 'env' | 'unset'
  value: string
  preview: string
}
interface OpsValues {
  maxRescanUrls: number
  rescanConcurrency: number
  cacheTtlSeconds: number
  sitemapMaxUrls: number
  renderTimeoutMs: number
  queueThrottleMs: number
  hardCacheTtlDays: number
  blockResources: boolean
}
interface SettingsData {
  cloudflare: CfField[]
  google: { set: boolean; source: string; preview: string }
  ops: {
    values: OpsValues
    defaults: OpsValues
    sources: Record<string, string>
  }
  usage: {
    renders: { today: number; month: number; all: number }
    cachedPages: number
    queue: { pending: number; rendering: number; completed: number; failed: number }
    diagnostics: { activeJobs: number; totalRuns: number }
    sites: number
    users: number
  }
}

const K = {
  account: 'cloudflare_account_id',
  token: 'cloudflare_api_token',
  kv: 'cloudflare_kv_namespace_id',
  brurl: 'cloudflare_browser_rendering_url',
}

function SourceTag({ source }: { source: string }) {
  const map: Record<string, { color: string; label: string }> = {
    db: { color: 'green', label: 'saved' },
    env: { color: 'blue', label: 'env var' },
    unset: { color: 'red', label: 'not set' },
    default: { color: 'default', label: 'default' },
  }
  const m = map[source] ?? map.default
  return <Tag color={m.color}>{m.label}</Tag>
}

export default function AdminSettingsPage() {
  const [data, setData] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; checks: { name: string; ok: boolean; message: string }[] } | null>(null)

  // Cloudflare form state
  const [account, setAccount] = useState('')
  const [token, setToken] = useState('')
  const [kv, setKv] = useState('')
  const [brurl, setBrurl] = useState('')
  // Ops form state
  const [ops, setOps] = useState<OpsValues>({ maxRescanUrls: 15, rescanConcurrency: 5, cacheTtlSeconds: 86400, sitemapMaxUrls: 500, renderTimeoutMs: 30000, queueThrottleMs: 1200, hardCacheTtlDays: 30, blockResources: true })
  // Google API key (Core Web Vitals) — only sent when a new value is typed.
  const [googleKey, setGoogleKey] = useState('')

  async function saveGoogle() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings: { google_api_key: googleKey } }),
      })
      if (res.ok) {
        message.success('Google API key saved')
        setGoogleKey('')
        load()
      } else message.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/settings')
      const d: SettingsData = await res.json()
      setData(d)
      const find = (k: string) => d.cloudflare.find((c) => c.key === k)
      setAccount(find(K.account)?.value ?? '')
      setKv(find(K.kv)?.value ?? '')
      setBrurl(find(K.brurl)?.value ?? '')
      setToken('') // never prefill the secret
      setOps(d.ops.values)
    } catch {
      message.error('Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const cf = (k: string) => data?.cloudflare.find((c) => c.key === k)

  async function runTest() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/admin/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account || undefined,
          apiToken: token || undefined, // tests typed token, else the saved one
          kvNamespaceId: kv || undefined,
        }),
      })
      setTestResult(await res.json())
    } catch {
      message.error('Test failed to run')
    } finally {
      setTesting(false)
    }
  }

  async function saveCloudflare() {
    setSaving(true)
    try {
      const settings: Record<string, string> = {
        [K.account]: account,
        [K.kv]: kv,
        [K.brurl]: brurl,
      }
      if (token) settings[K.token] = token // only change the token if a new one was typed
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (res.ok) {
        message.success('Cloudflare settings saved')
        setToken('')
        load()
      } else message.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function saveOps() {
    setSaving(true)
    try {
      const settings = {
        max_rescan_urls: String(ops.maxRescanUrls),
        rescan_concurrency: String(ops.rescanConcurrency),
        cache_ttl_seconds: String(ops.cacheTtlSeconds),
        sitemap_max_urls: String(ops.sitemapMaxUrls),
        render_timeout_ms: String(ops.renderTimeoutMs),
        queue_throttle_ms: String(ops.queueThrottleMs),
        hard_cache_ttl_days: String(ops.hardCacheTtlDays),
        block_resources: ops.blockResources ? '1' : '0',
      }
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (res.ok) {
        message.success('Render queue settings saved')
        load()
      } else message.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />

  const u = data?.usage

  return (
    <div style={{ maxWidth: 1100 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        Platform Settings
      </Title>
      <Paragraph type="secondary">
        Cloudflare credentials and render-queue limits. Values saved here override the env vars —
        no redeploy needed. Use <b>Test connection</b> before saving.
      </Paragraph>

      <Row gutter={[16, 16]}>
        {/* ── Cloudflare config ─────────────────────────────────────────────── */}
        <Col xs={24} lg={14}>
          <Card title={<Space><CloudServerOutlined /> Cloudflare</Space>}>
            <label>
              <Space>
                <ApiOutlined /> Account ID <SourceTag source={cf(K.account)?.source ?? 'unset'} />
              </Space>
            </label>
            <Input value={account} onChange={(e) => setAccount(e.target.value)} placeholder="account id" style={{ marginBottom: 14 }} />

            <label>
              <Space>
                <ApiOutlined /> API Token <SourceTag source={cf(K.token)?.source ?? 'unset'} />
                {cf(K.token)?.preview && <Text type="secondary" style={{ fontSize: 12 }}>current: {cf(K.token)?.preview}</Text>}
              </Space>
            </label>
            <Input.Password
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={cf(K.token)?.set ? 'leave blank to keep current' : 'paste cfat_… token'}
              style={{ marginBottom: 14 }}
            />

            <label>
              <Space>
                <DatabaseOutlined /> KV Namespace ID <SourceTag source={cf(K.kv)?.source ?? 'unset'} />
              </Space>
            </label>
            <Input value={kv} onChange={(e) => setKv(e.target.value)} placeholder="kv namespace id (for caching)" style={{ marginBottom: 14 }} />

            <label>
              <Space>
                Browser Rendering URL <Text type="secondary" style={{ fontSize: 12 }}>(optional override)</Text>
              </Space>
            </label>
            <Input value={brurl} onChange={(e) => setBrurl(e.target.value)} placeholder="leave blank for default endpoint" style={{ marginBottom: 16 }} />

            <Space>
              <Button icon={<ExperimentOutlined />} loading={testing} onClick={runTest}>
                Test connection
              </Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveCloudflare} style={{ background: BRAND, borderColor: BRAND }}>
                Save Cloudflare
              </Button>
            </Space>

            {testResult && (
              <div style={{ marginTop: 16 }}>
                <Alert
                  type={testResult.ok ? 'success' : 'warning'}
                  showIcon
                  message={testResult.ok ? 'All checks passed' : 'Some checks failed'}
                  description={
                    <div>
                      {testResult.checks.map((c) => (
                        <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {c.ok ? <CheckCircleFilled style={{ color: BRAND }} /> : <CloseCircleFilled style={{ color: '#ff4d4f' }} />}
                          <b>{c.name}:</b> {c.message}
                        </div>
                      ))}
                    </div>
                  }
                />
              </div>
            )}
          </Card>

          {/* ── Render queue & limits ───────────────────────────────────────── */}
          <Card title={<Space><ThunderboltOutlined /> Render Queue & Limits</Space>} style={{ marginTop: 16 }}>
            <Row gutter={[16, 16]}>
              <Col xs={12}>
                <Text>Max URLs per scan</Text>
                <InputNumber min={1} max={500} value={ops.maxRescanUrls} onChange={(v) => setOps({ ...ops, maxRescanUrls: v ?? 15 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>default {data?.ops.defaults.maxRescanUrls}</Text>
              </Col>
              <Col xs={12}>
                <Text>Scan concurrency</Text>
                <InputNumber min={1} max={20} value={ops.rescanConcurrency} onChange={(v) => setOps({ ...ops, rescanConcurrency: v ?? 5 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>default {data?.ops.defaults.rescanConcurrency}</Text>
              </Col>
              <Col xs={12}>
                <Text>Cache TTL (seconds)</Text>
                <InputNumber min={60} value={ops.cacheTtlSeconds} onChange={(v) => setOps({ ...ops, cacheTtlSeconds: v ?? 86400 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>{Math.round(ops.cacheTtlSeconds / 3600)}h · default {data?.ops.defaults.cacheTtlSeconds}</Text>
              </Col>
              <Col xs={12}>
                <Text>Sitemap max URLs</Text>
                <InputNumber min={1} max={10000} value={ops.sitemapMaxUrls} onChange={(v) => setOps({ ...ops, sitemapMaxUrls: v ?? 500 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>default {data?.ops.defaults.sitemapMaxUrls}</Text>
              </Col>
              <Col xs={12}>
                <Text>Render timeout (ms)</Text>
                <InputNumber min={5000} max={120000} step={1000} value={ops.renderTimeoutMs} onChange={(v) => setOps({ ...ops, renderTimeoutMs: v ?? 30000 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>{Math.round(ops.renderTimeoutMs / 1000)}s · default {data?.ops.defaults.renderTimeoutMs}</Text>
              </Col>
              <Col xs={12}>
                <Space size={4}>
                  <Text>Queue throttle (ms)</Text>
                  <Tooltip title="Pause between renders while draining the queue. Higher = gentler on Cloudflare's rate limit (raise it if you see rate-limit errors).">
                    <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                  </Tooltip>
                </Space>
                <InputNumber min={0} max={10000} step={100} value={ops.queueThrottleMs} onChange={(v) => setOps({ ...ops, queueThrottleMs: v ?? 1200 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>default {data?.ops.defaults.queueThrottleMs}</Text>
              </Col>
              <Col xs={12}>
                <Space size={4}>
                  <Text>Hard cache TTL (days)</Text>
                  <Tooltip title="How long a rendered page stays in Workers KV. Freshness is handled separately by change-detection, so this is mainly a storage-retention / cleanup bound.">
                    <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                  </Tooltip>
                </Space>
                <InputNumber min={1} max={365} value={ops.hardCacheTtlDays} onChange={(v) => setOps({ ...ops, hardCacheTtlDays: v ?? 30 })} style={{ width: '100%' }} />
                <Text type="secondary" style={{ fontSize: 12 }}>default {data?.ops.defaults.hardCacheTtlDays}</Text>
              </Col>
              <Col xs={12}>
                <Space size={4}>
                  <Text>Block heavy resources</Text>
                  <Tooltip title="Skip downloading images/fonts/media during render → faster, cheaper renders. Disable if a site's content depends on them (e.g. image lazy-loading).">
                    <InfoCircleOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                  </Tooltip>
                </Space>
                <div style={{ marginTop: 4 }}>
                  <Switch checked={ops.blockResources} onChange={(v) => setOps({ ...ops, blockResources: v })} checkedChildren="On" unCheckedChildren="Off" />
                  <Text type="secondary" style={{ fontSize: 12, marginLeft: 8 }}>images · fonts · media</Text>
                </div>
              </Col>
            </Row>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveOps} style={{ background: BRAND, borderColor: BRAND, marginTop: 16 }}>
              Save limits
            </Button>
          </Card>

          {/* ── Core Web Vitals (Google CrUX API key) ───────────────────────── */}
          <Card title={<Space><ExperimentOutlined /> Core Web Vitals (Google API key)</Space>} style={{ marginTop: 16 }}>
            <Paragraph type="secondary" style={{ marginTop: 0 }}>
              Enables real-user LCP/CLS/INP in diagnostics via the Chrome UX Report API. Create a key
              in Google Cloud with the <b>Chrome UX Report API</b> enabled.
            </Paragraph>
            <label>
              <Space>
                API key <SourceTag source={data?.google.source ?? 'unset'} />
                {data?.google.preview && <Text type="secondary" style={{ fontSize: 12 }}>current: {data.google.preview}</Text>}
              </Space>
            </label>
            <Input.Password
              value={googleKey}
              onChange={(e) => setGoogleKey(e.target.value)}
              placeholder={data?.google.set ? 'leave blank to keep current' : 'paste Google API key'}
              style={{ marginTop: 4, marginBottom: 12 }}
            />
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveGoogle} disabled={!googleKey} style={{ background: BRAND, borderColor: BRAND }}>
              Save key
            </Button>
          </Card>
        </Col>

        {/* ── Usage ─────────────────────────────────────────────────────────── */}
        <Col xs={24} lg={10}>
          <Card title="Usage">
            <Row gutter={[12, 12]}>
              <Col xs={12}><Statistic title="Renders today" value={u?.renders.today ?? 0} /></Col>
              <Col xs={12}><Statistic title="Renders (30d)" value={u?.renders.month ?? 0} /></Col>
              <Col xs={12}><Statistic title="Renders all-time" value={u?.renders.all ?? 0} /></Col>
              <Col xs={12}><Statistic title="Cached pages" value={u?.cachedPages ?? 0} /></Col>
            </Row>
            <Divider style={{ margin: '14px 0' }} />
            <Text strong>Caching queue</Text>
            <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
              <Col xs={12}><Statistic title="Pending" value={u?.queue.pending ?? 0} valueStyle={{ color: '#faad14' }} /></Col>
              <Col xs={12}><Statistic title="Rendering" value={u?.queue.rendering ?? 0} valueStyle={{ color: '#1677ff' }} /></Col>
              <Col xs={12}><Statistic title="Completed" value={u?.queue.completed ?? 0} valueStyle={{ color: BRAND }} /></Col>
              <Col xs={12}><Statistic title="Failed" value={u?.queue.failed ?? 0} valueStyle={{ color: '#ff4d4f' }} /></Col>
            </Row>
            <Divider style={{ margin: '14px 0' }} />
            <Row gutter={[12, 12]}>
              <Col xs={12}><Statistic title="Diagnostics runs" value={u?.diagnostics.totalRuns ?? 0} /></Col>
              <Col xs={12}><Statistic title="Active scan jobs" value={u?.diagnostics.activeJobs ?? 0} /></Col>
              <Col xs={12}><Statistic title="Sites" value={u?.sites ?? 0} /></Col>
              <Col xs={12}><Statistic title="Users" value={u?.users ?? 0} /></Col>
            </Row>
          </Card>
        </Col>
      </Row>
    </div>
  )
}
