'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  Row,
  Col,
  Card,
  Button,
  Input,
  Progress,
  Tag,
  Table,
  Select,
  Alert,
  Empty,
  Skeleton,
  Typography,
  Space,
  Tooltip,
  Popover,
  message,
} from 'antd'
import {
  RobotOutlined,
  PlusOutlined,
  DeleteOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  ScanOutlined,
  LockOutlined,
  LinkOutlined,
  ClockCircleOutlined,
  SaveOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'
import { LineChart, BarChart } from '@/components/charts/Charts'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

type AiEngine = 'chatgpt' | 'gemini' | 'claude' | 'grok' | 'perplexity'
const ENGINE_LABELS: Record<AiEngine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  grok: 'Grok',
  perplexity: 'Perplexity',
}
interface EngineCell {
  mentioned: boolean
  citationUrl: string | null
  snippet: string | null
  error: string | null
}
interface BreakdownRow {
  promptText: string
  engines: Partial<Record<AiEngine, EngineCell>>
}
interface AiVisibilityData {
  plan: string
  quota: number
  enabled: boolean
  enginesReady: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  domain: string
  brandName: string
  tracking: boolean
  lastCheckedAt: string | null
  prompts: { id: string; prompt: string }[]
  score: number | null
  breakdown: BreakdownRow[]
  enginesUsed: AiEngine[]
  trend: { date: string; score: number }[]
}

// Suggest a brand name from a domain (example.com → Example).
function brandFromDomain(domain: string): string {
  const root = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('.')[0] ?? ''
  return root ? root.charAt(0).toUpperCase() + root.slice(1) : ''
}

function scoreColor(score: number) {
  if (score < 34) return '#ff4d4f'
  if (score < 67) return '#faad14'
  return BRAND
}

// One engine's ✅/❌ cell, with citation proof in a popover when present.
function EngineResultCell({ cell }: { cell: EngineCell | null }) {
  if (!cell) return <Text type="secondary">—</Text>
  if (cell.error && !cell.mentioned) {
    return (
      <Tooltip title={cell.error}>
        <Tag color="default">error</Tag>
      </Tooltip>
    )
  }
  if (!cell.mentioned) {
    return <CloseCircleFilled style={{ color: '#d9d9d9', fontSize: 18 }} />
  }
  const proof = (
    <div style={{ maxWidth: 320 }}>
      {cell.snippet && (
        <Paragraph style={{ fontSize: 12, marginBottom: 8 }} italic>
          “{cell.snippet}”
        </Paragraph>
      )}
      {cell.citationUrl && (
        <a href={cell.citationUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: BRAND }}>
          <LinkOutlined /> {cell.citationUrl.length > 48 ? cell.citationUrl.slice(0, 48) + '…' : cell.citationUrl}
        </a>
      )}
      {!cell.snippet && !cell.citationUrl && <Text type="secondary" style={{ fontSize: 12 }}>Brand mentioned in the answer.</Text>}
    </div>
  )
  return (
    <Popover content={proof} title="Citation proof" trigger="hover">
      <span style={{ cursor: 'pointer' }}>
        <CheckCircleFilled style={{ color: BRAND, fontSize: 18 }} />
        {cell.citationUrl && <LinkOutlined style={{ color: BRAND, marginLeft: 6, fontSize: 12 }} />}
      </span>
    </Popover>
  )
}

export default function AiVisibilityPage() {
  const { sites, selectedSiteId, setSelectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const { data, isLoading, mutate } = useSWR<AiVisibilityData>(
    siteId ? `/api/ai-visibility?site_id=${siteId}` : null
  )

  // Local editable state (brand + prompts) — seeded from the fetched config.
  const [brand, setBrand] = useState('')
  const [prompts, setPrompts] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [generating, setGenerating] = useState(false)

  useEffect(() => {
    if (!data) return
    setBrand(data.brandName || brandFromDomain(data.domain))
    setPrompts(data.prompts.length > 0 ? data.prompts.map((p) => p.prompt) : [''])
  }, [data])

  const quota = data?.quota ?? 0
  const nonEmpty = prompts.map((p) => p.trim()).filter(Boolean)

  async function save(): Promise<boolean> {
    if (!siteId) return false
    if (!brand.trim()) {
      message.warning('Enter your brand name')
      return false
    }
    setSaving(true)
    try {
      const res = await fetch('/api/ai-visibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, brand_name: brand.trim(), prompts: nonEmpty }),
      })
      const d = await res.json()
      if (!res.ok) {
        message.error(d.error ?? 'Save failed')
        return false
      }
      await mutate()
      return true
    } finally {
      setSaving(false)
    }
  }

  // Run a scan against whatever prompts are currently saved.
  async function scanOnly(): Promise<boolean> {
    if (!siteId) return false
    setScanning(true)
    const hide = message.loading('Checking AI engines… this can take a minute.', 0)
    try {
      const res = await fetch('/api/ai-visibility/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId }),
      })
      const d = await res.json()
      if (!res.ok) {
        message.error(d.error ?? 'Scan failed')
        return false
      }
      message.success(`Done — visibility score ${d.score}%`)
      await mutate()
      return true
    } catch {
      message.error('Scan failed')
      return false
    } finally {
      hide()
      setScanning(false)
    }
  }

  // Auto-generate keywords (saves brand + prompts). Returns success.
  async function generateKeywords(): Promise<boolean> {
    if (!siteId) return false
    setGenerating(true)
    const hide = message.loading('Generating keywords from your brand & niche…', 0)
    try {
      const res = await fetch('/api/ai-visibility/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ site_id: siteId, brand_name: brand.trim() || undefined }),
      })
      const d = await res.json()
      if (!res.ok) {
        message.error(d.error ?? 'Could not generate keywords')
        return false
      }
      await mutate()
      message.success(`Generated ${d.prompts.length} keywords`)
      return true
    } catch {
      message.error('Could not generate keywords')
      return false
    } finally {
      hide()
      setGenerating(false)
    }
  }

  // The fully-automatic path: generate keywords, then immediately scan.
  async function autoRun() {
    const ok = await generateKeywords()
    if (ok) await scanOnly()
  }

  // Manual "Start Tracking" — save the edited prompts, then scan.
  async function startTracking() {
    if (nonEmpty.length === 0) {
      message.warning('Add at least one keyword, or use Auto-Generate')
      return
    }
    const ok = await save()
    if (ok) await scanOnly()
  }

  const addPrompt = () => {
    if (prompts.length >= quota) {
      message.warning(`Your plan allows up to ${quota} prompts`)
      return
    }
    setPrompts((p) => [...p, ''])
  }
  const setPrompt = (i: number, v: string) => setPrompts((p) => p.map((x, j) => (j === i ? v : x)))
  const removePrompt = (i: number) => setPrompts((p) => (p.length === 1 ? [''] : p.filter((_, j) => j !== i)))

  // ── Header (always shown) ─────────────────────────────────────────────────
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>
          <RobotOutlined style={{ color: BRAND, marginRight: 8 }} />
          AI Visibility Tracker
        </Title>
        <Text type="secondary">See whether ChatGPT, Gemini, Claude, Grok &amp; Perplexity recommend your brand for the queries that matter.</Text>
      </div>
      <Select
        placeholder="Select a site"
        style={{ minWidth: 220 }}
        value={siteId}
        onChange={(v) => setSelectedSiteId(v)}
        options={sites.map((s) => ({ value: s.id, label: s.name || s.domain }))}
      />
    </div>
  )

  if (!siteId) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <Card><Empty description="Add a site to start tracking AI visibility." /></Card>
      </div>
    )
  }

  if (isLoading && !data) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
      </div>
    )
  }

  // ── Paid-tier gate ────────────────────────────────────────────────────────
  if (data && !data.enabled) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <Card style={{ textAlign: 'center', padding: '40px 20px' }}>
          <LockOutlined style={{ fontSize: 48, color: '#bfbfbf' }} />
          <Title level={4} style={{ marginTop: 16 }}>Unlock AI Visibility Tracking</Title>
          <Paragraph type="secondary" style={{ maxWidth: 460, margin: '0 auto 20px' }}>
            Track whether AI answer engines like ChatGPT and Perplexity cite your brand for your
            target search queries. This feature is available on paid plans.
          </Paragraph>
          <Link href="/dashboard/billing">
            <Button type="primary" size="large" style={{ background: BRAND, borderColor: BRAND }}>
              Upgrade your plan
            </Button>
          </Link>
        </Card>
      </div>
    )
  }

  const score = data?.score ?? null
  const trend = data?.trend ?? []
  const breakdown = data?.breakdown ?? []
  const enginesUsed = data?.enginesUsed ?? []
  const freqLabel = { daily: 'daily', weekly: 'weekly', monthly: 'monthly' }[data?.frequency ?? 'weekly']

  // Prompt column + one ✅/❌ column per engine that appeared in the latest run.
  const breakdownColumns = [
    { title: 'Prompt', dataIndex: 'promptText', render: (t: string) => <Text>{t}</Text> },
    ...enginesUsed.map((engine) => ({
      title: <Tooltip title={ENGINE_LABELS[engine]}>{ENGINE_LABELS[engine]}</Tooltip>,
      key: engine,
      width: 110,
      align: 'center' as const,
      render: (_: unknown, row: BreakdownRow) => <EngineResultCell cell={row.engines[engine] ?? null} />,
    })),
  ]

  return (
    <div style={{ padding: 24 }}>
      {header}

      {data && !data.enginesReady && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="AI engine keys not configured yet"
          description="Your prompts will be saved, but checks can't run until the platform admin adds at least one AI engine API key."
        />
      )}

      {/* ── Setup: brand + automatic keywords ────────────────────────────────── */}
      <Card
        title={<StatTitle hint="Confirm your brand name, then let us automatically generate the niche search queries your potential customers ask AI assistants. Each keyword is checked against every configured AI engine.">1 · Set up tracking</StatTitle>}
        style={{ marginBottom: 20 }}
      >
        <Row gutter={[24, 16]} align="bottom">
          <Col xs={24} md={10}>
            <Text strong>Brand name</Text>
            <Input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              placeholder="e.g. RenderForAI"
              style={{ marginTop: 6 }}
            />
            <Text type="secondary" style={{ fontSize: 12 }}>
              Auto-filled from your domain. We look for this name (or your domain) in AI answers.
            </Text>
          </Col>
          <Col xs={24} md={14}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={generating || scanning}
                onClick={autoRun}
                disabled={!data?.enginesReady}
                style={{ background: BRAND, borderColor: BRAND }}
              >
                {data?.tracking ? 'Regenerate Keywords & Re-check' : 'Auto-Generate Keywords & Track'}
              </Button>
              {data?.tracking && nonEmpty.length > 0 && (
                <Button icon={<ScanOutlined />} loading={scanning} onClick={scanOnly} disabled={!data?.enginesReady}>
                  Check now
                </Button>
              )}
            </div>
            <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 8 }}>
              We generate up to {quota} keywords from your niche automatically — no need to write them yourself. Recommended re-check: {freqLabel}.
            </Text>
          </Col>
        </Row>

        {/* Generated keywords — visible & editable (collapsed by default once set). */}
        <div style={{ marginTop: 18, borderTop: '1px solid #f0f0f0', paddingTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Text strong>Tracked keywords {nonEmpty.length > 0 && <Text type="secondary" style={{ fontWeight: 400 }}>(auto-generated — edit if you like)</Text>}</Text>
            <Tag color={nonEmpty.length >= quota ? 'red' : 'default'}>{nonEmpty.length} / {quota}</Tag>
          </div>
          {nonEmpty.length === 0 ? (
            <Text type="secondary">No keywords yet — press <b>Auto-Generate Keywords &amp; Track</b> above to create them automatically.</Text>
          ) : (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {prompts.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8 }}>
                    <Input value={p} onChange={(e) => setPrompt(i, e.target.value)} placeholder="search query" />
                    <Button icon={<DeleteOutlined />} onClick={() => removePrompt(i)} />
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button type="dashed" icon={<PlusOutlined />} onClick={addPrompt} disabled={prompts.length >= quota}>
                  Add keyword
                </Button>
                <Button icon={<SaveOutlined />} loading={saving} onClick={save}>
                  Save edits
                </Button>
                <Button icon={<ScanOutlined />} loading={scanning} onClick={startTracking} disabled={!data?.enginesReady}>
                  Save &amp; Check
                </Button>
              </div>
            </>
          )}
        </div>
      </Card>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {score == null ? (
        <Card>
          <Empty description={data?.tracking ? 'No results yet.' : 'Press “Auto-Generate Keywords & Track” to run your first check.'} />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
            {/* Visibility score */}
            <Col xs={24} md={8}>
              <Card title={<StatTitle hint="Percentage of your tracked prompts where your brand was mentioned or cited by at least one AI engine in the latest check.">Visibility Score</StatTitle>}>
                <div style={{ textAlign: 'center', padding: '8px 0' }}>
                  <Progress
                    type="circle"
                    percent={score}
                    size={160}
                    strokeColor={scoreColor(score)}
                    format={(p) => <span style={{ color: scoreColor(score), fontWeight: 700 }}>{p}%</span>}
                  />
                  <div style={{ marginTop: 14 }}>
                    <Tag color={score >= 67 ? 'green' : score >= 34 ? 'orange' : 'red'}>
                      {score >= 67 ? 'Strong' : score >= 34 ? 'Building' : 'Low'} presence
                    </Tag>
                  </div>
                  {data?.lastCheckedAt && (
                    <div style={{ marginTop: 10, color: '#9ca3af', fontSize: 12 }}>
                      <ClockCircleOutlined /> Last checked {new Date(data.lastCheckedAt).toLocaleString()}
                    </div>
                  )}
                </div>
              </Card>
            </Col>

            {/* Trend */}
            <Col xs={24} md={16}>
              <Card title={<StatTitle hint="Your visibility score over time — is your brand getting cited more or less by AI engines?">Visibility Trend</StatTitle>}>
                {trend.length < 2 ? (
                  <div style={{ padding: '48px 0', textAlign: 'center', color: '#9ca3af' }}>
                    Run a few more checks over time to see your trend here.
                  </div>
                ) : (
                  <LineChart
                    labels={trend.map((t) => t.date.slice(5))}
                    series={[{ label: 'Visibility %', color: BRAND, points: trend.map((t) => t.score) }]}
                    fill
                    height={220}
                    unit="%"
                  />
                )}
              </Card>
            </Col>
          </Row>

          {/* Visibility by engine — works on the first run (no history needed) */}
          {enginesUsed.length > 0 && (
            <Card
              title={<StatTitle hint="How many of your tracked keywords each AI engine mentioned or cited your brand in, during the latest check.">Visibility by Engine</StatTitle>}
              style={{ marginBottom: 20 }}
            >
              <BarChart
                data={enginesUsed.map((e) => ({
                  label: ENGINE_LABELS[e],
                  value: breakdown.filter((r) => r.engines[e]?.mentioned).length,
                }))}
                height={220}
                unit={`of ${breakdown.length} keywords`}
                formatValue={(v) => `${v}/${breakdown.length}`}
              />
            </Card>
          )}

          {/* Per-prompt breakdown */}
          <Card title={<StatTitle hint="For each keyword, whether each AI engine mentioned/cited your brand. Hover a ✅ to see the proof (snippet + citation URL).">Per-Keyword Breakdown</StatTitle>}>
            <Table<BreakdownRow>
              rowKey="promptText"
              pagination={false}
              dataSource={breakdown}
              scroll={{ x: 'max-content' }}
              columns={breakdownColumns}
            />
          </Card>
        </>
      )}
    </div>
  )
}
