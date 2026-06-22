'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Steps,
  Card,
  Input,
  Button,
  Typography,
  Space,
  Alert,
  Result,
  Tag,
  Statistic,
  Row,
  Col,
  message,
} from 'antd'
import {
  GlobalOutlined,
  ApiOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  RocketOutlined,
  CopyOutlined,
} from '@ant-design/icons'
import { useDashboard } from '@/lib/dashboard-context'
import type { DbSite } from '@/lib/supabase'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography
const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || (typeof window !== 'undefined' ? window.location.origin : 'https://renderforai.com')

interface RenderResult {
  ok: boolean
  url?: string
  title?: string | null
  htmlLength?: number
  renderTimeMs?: number
  statusCode?: number
  error?: string
}

export default function OnboardingPage() {
  const router = useRouter()
  const { sites, user, setSelectedSiteId } = useDashboard()

  const [step, setStep] = useState(0)
  const [domain, setDomain] = useState('')
  const [site, setSite] = useState<DbSite | null>(null)
  const [creating, setCreating] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [result, setResult] = useState<RenderResult | null>(null)

  // If the user already has a site, start from the integration step.
  useEffect(() => {
    if (!site && sites.length > 0) {
      setSite(sites[0])
      setStep((s) => (s === 0 ? 1 : s))
    }
  }, [sites, site])

  const apiKey = user?.api_key ?? 'YOUR_API_KEY'

  async function addDomain() {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) {
      message.error('Enter a valid domain, e.g. example.com')
      return
    }
    setCreating(true)
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: d }),
      })
      const data = await res.json()
      if (res.ok) {
        setSite(data.site)
        setSelectedSiteId(data.site.id)
        setStep(1)
      } else if (res.status === 409) {
        // Already added — fetch it and continue.
        const list = await fetch('/api/sites').then((r) => r.json())
        const existing = (list.sites ?? []).find((s: DbSite) => s.domain === d) ?? (list.sites ?? [])[0]
        if (existing) {
          setSite(existing)
          setSelectedSiteId(existing.id)
          setStep(1)
        } else message.error(data.error ?? 'Could not add domain')
      } else {
        message.error(data.error ?? 'Could not add domain')
      }
    } finally {
      setCreating(false)
    }
  }

  async function runFirstRender() {
    if (!site) return
    setRendering(true)
    setResult(null)
    try {
      const res = await fetch('/api/onboarding/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId: site.id }),
      })
      const data: RenderResult = await res.json()
      setResult(data)
      if (data.ok) {
        try {
          localStorage.setItem('rf_onboarded', '1')
        } catch {
          /* ignore */
        }
        setStep(3)
      }
    } catch {
      setResult({ ok: false, error: 'Render request failed' })
    } finally {
      setRendering(false)
    }
  }

  function copy(text: string) {
    navigator.clipboard.writeText(text)
    message.success('Copied')
  }

  return (
    <div style={{ padding: 24, maxWidth: 820, margin: '0 auto' }}>
      <div style={{ textAlign: 'center', marginBottom: 20 }}>
        <Title level={3} style={{ marginBottom: 4 }}>
          <Space>
            <RocketOutlined style={{ color: BRAND }} /> Welcome to RenderForAI
          </Space>
        </Title>
        <Text type="secondary">Three quick steps and search &amp; AI bots will see your fully-rendered pages.</Text>
      </div>

      <Steps
        current={step}
        style={{ marginBottom: 24 }}
        items={[
          { title: 'Add domain', icon: <GlobalOutlined /> },
          { title: 'Connect', icon: <ApiOutlined /> },
          { title: 'First render', icon: <ThunderboltOutlined /> },
          { title: 'Done', icon: <CheckCircleOutlined /> },
        ]}
      />

      {/* ── Step 0: add domain ──────────────────────────────────────────────── */}
      {step === 0 && (
        <Card title="Add your first domain">
          <Paragraph type="secondary" style={{ marginTop: 0 }}>
            Enter the website you want search &amp; AI crawlers to index fully.
          </Paragraph>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              size="large"
              addonBefore="https://"
              placeholder="example.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              onPressEnter={addDomain}
            />
            <Button size="large" type="primary" loading={creating} onClick={addDomain} style={{ background: BRAND, borderColor: BRAND }}>
              Add domain
            </Button>
          </Space.Compact>
        </Card>
      )}

      {/* ── Step 1: connect / integrate ─────────────────────────────────────── */}
      {step === 1 && site && (
        <Card title={<Space><ApiOutlined /> Connect {site.domain}</Space>}>
          <Paragraph type="secondary" style={{ marginTop: 0 }}>
            Route bot traffic through RenderForAI so crawlers get the prerendered HTML. Use any
            method below — full per-platform guides are in the Integration Guide.
          </Paragraph>
          <div style={{ background: '#f6f8fa', border: '1px solid #eaecef', borderRadius: 8, padding: 14, fontFamily: 'monospace', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Endpoint</span>
              <a onClick={() => copy(`${APP_URL}/api/proxy`)} style={{ cursor: 'pointer' }}><CopyOutlined /></a>
            </div>
            <div style={{ color: BRAND, marginBottom: 10 }}>{APP_URL}/api/proxy?url=&lt;your-page&gt;</div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Header</span>
              <a onClick={() => copy(apiKey)} style={{ cursor: 'pointer' }}><CopyOutlined /></a>
            </div>
            <div style={{ color: '#555' }}>X-Prerender-Token: {apiKey}</div>
          </div>
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 12 }}
            message="You can finish this later"
            description="Integration is how live bots get served. First, let's prove RenderForAI can render your site — click Continue."
          />
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setStep(2)} type="primary" style={{ background: BRAND, borderColor: BRAND }}>
              Continue
            </Button>
            <Link href="/integration-wizard">
              <Button>Open full Integration Guide</Button>
            </Link>
          </Space>
        </Card>
      )}

      {/* ── Step 2: first render ────────────────────────────────────────────── */}
      {step === 2 && site && (
        <Card title={<Space><ThunderboltOutlined /> Render your homepage</Space>}>
          <Paragraph type="secondary" style={{ marginTop: 0 }}>
            We&apos;ll render <strong>{site.domain}</strong> with a real browser and show you exactly
            what bots will receive. This also warms your cache.
          </Paragraph>
          <Button type="primary" size="large" loading={rendering} icon={<ThunderboltOutlined />} onClick={runFirstRender} style={{ background: BRAND, borderColor: BRAND }}>
            {rendering ? 'Rendering…' : 'Run my first render'}
          </Button>
          {result && !result.ok && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 16 }}
              message="Render didn't complete"
              description={
                <span>
                  {result.error ?? 'Unknown error'}. Make sure the domain is publicly reachable. If
                  rendering isn&apos;t configured yet, an admin needs to connect Cloudflare.
                </span>
              }
            />
          )}
          <div style={{ marginTop: 12 }}>
            <Button type="text" onClick={() => setStep(1)}>Back</Button>
          </div>
        </Card>
      )}

      {/* ── Step 3: done ────────────────────────────────────────────────────── */}
      {step === 3 && result?.ok && (
        <Card>
          <Result
            status="success"
            title="Your site is RenderForAI-ready 🎉"
            subTitle={`We rendered ${site?.domain} successfully. Bots will now get the fully-rendered page.`}
          />
          <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
            <Col xs={12} md={6}><Statistic title="Render time" value={result.renderTimeMs ?? 0} suffix="ms" /></Col>
            <Col xs={12} md={6}><Statistic title="Status" value={result.statusCode ?? 200} /></Col>
            <Col xs={12} md={6}><Statistic title="Content" value={Math.round((result.htmlLength ?? 0) / 1024)} suffix="KB" /></Col>
            <Col xs={12} md={6}><Statistic title="Cached" value="Yes" valueStyle={{ color: BRAND }} /></Col>
          </Row>
          {result.title && (
            <Alert type="success" showIcon style={{ marginBottom: 16 }} message={<span>Page title detected: <strong>{result.title}</strong></span>} />
          )}
          <Space wrap style={{ justifyContent: 'center', width: '100%' }}>
            <Button type="primary" size="large" onClick={() => router.push('/dashboard')} style={{ background: BRAND, borderColor: BRAND }}>
              Go to Dashboard
            </Button>
            <Button size="large" onClick={() => router.push('/bot-visibility')}>
              See what bots see
            </Button>
            <Button size="large" onClick={() => router.push('/integration-wizard')}>
              Finish integration
            </Button>
          </Space>
        </Card>
      )}
    </div>
  )
}
