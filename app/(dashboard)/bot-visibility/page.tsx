'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Row,
  Col,
  Card,
  Button,
  Progress,
  Collapse,
  Tag,
  Select,
  Alert,
  Empty,
  Skeleton,
  Typography,
  Space,
  Tooltip,
  message,
} from 'antd'
import {
  ScanOutlined,
  EyeInvisibleOutlined,
  TagsOutlined,
  BugOutlined,
  CloseCircleOutlined,
  WarningOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import Link from 'next/link'
import { useDashboard } from '@/lib/dashboard-context'
import { DonutChart, Legend } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

// Content-diff threshold above which a page counts as "hidden from crawlers".
const CONTENT_DIFF_THRESHOLD = 20

// Concrete fix hint per missing SEO element.
const SEO_FIX: Record<string, string> = {
  title: 'Add a unique <title> (50–60 chars) inside the page <head>.',
  meta_description: 'Add <meta name="description" content="…"> (150–160 chars) in <head>.',
  h1: 'Add a single descriptive <h1> as the page’s main heading.',
  canonical: 'Add <link rel="canonical" href="…"> in <head> to avoid duplicate-content issues.',
  jsonld: 'Add JSON-LD structured data (<script type="application/ld+json">) for rich results.',
}

interface FailedRequest {
  url: string
  resourceType: string
  reason: string
}

interface UrlIssue {
  url: string
  score: number
  contentDiffPercentage: number
  renderSucceeded: boolean
  renderTimeMs: number | null
  missingSeoElements: string[]
  consoleErrors: string[]
  failedRequests: FailedRequest[]
  consoleErrorCount: number
  failedRequestCount: number
  renderedAt: string
}

interface Recommendation {
  issue: string
  message: string
  impact: string
  source: string
  priority: number
}

interface AiPage {
  url: string
  aiCitationScore: number | null
  recommendations: Recommendation[]
}

interface DiagSummary {
  domain: string
  healthScore: number | null
  urlsChecked: number
  totalRendered: number
  distribution?: { good: number; needsWork: number; poor: number }
  healthy?: number
  urlsWithIssues: UrlIssue[]
  topErrors: { message: string; count: number }[]
  aiCitationScore?: number | null
  aiPages?: AiPage[]
  message?: string
}

interface ScanJob {
  id: string
  status: 'queued' | 'running' | 'done' | 'failed'
  total_count: number
  done_count: number
  error_message?: string | null
}

function scoreColor(score: number) {
  if (score < 50) return '#ff4d4f'
  if (score < 70) return '#faad14'
  return BRAND
}

// Friendly label for the internal SEO element keys.
const SEO_LABEL: Record<string, string> = {
  title: 'title',
  meta_description: 'meta description',
  h1: 'H1',
  canonical: 'canonical',
  jsonld: 'JSON-LD',
}

interface DerivedIssue {
  key: string
  label: string
  detail: string
  color: string
  icon: React.ReactNode
  fix: React.ReactNode // actionable "how to fix" guidance
  action?: { label: string; href: string } // optional in-app link
}

// Derive the human-readable issues + how-to-fix guidance shown for one URL.
function deriveIssues(u: UrlIssue): DerivedIssue[] {
  const out: DerivedIssue[] = []

  if (!u.renderSucceeded)
    out.push({
      key: 'render',
      label: 'Render failed',
      detail: 'Page render did not complete — main content may be empty.',
      color: 'red',
      icon: <CloseCircleOutlined />,
      fix: 'Confirm the URL loads in a browser and that rendering is configured (Cloudflare). Then re-scan this domain.',
      action: { label: 'Set up rendering', href: '/integration-wizard' },
    })

  if (u.contentDiffPercentage > CONTENT_DIFF_THRESHOLD)
    out.push({
      key: 'content',
      label: 'Content hidden from AI bots/crawlers',
      detail: `${u.contentDiffPercentage}% of content invisible to crawlers (only appears after JS).`,
      color: 'orange',
      icon: <EyeInvisibleOutlined />,
      fix: 'This page builds its content with JavaScript, which most crawlers (Googlebot, GPTBot, ClaudeBot) don’t fully execute — so they see a near-empty page. Serve them the pre-rendered HTML: make sure your RenderFast integration is active on this domain (it returns the fully-rendered page to bots). For best results also server-render critical content.',
      action: { label: 'Check integration', href: '/integration-wizard' },
    })

  if (u.missingSeoElements.length > 0)
    out.push({
      key: 'seo',
      label: 'Missing SEO tag',
      detail: `Missing: ${u.missingSeoElements.map((e) => SEO_LABEL[e] ?? e).join(', ')}`,
      color: 'gold',
      icon: <TagsOutlined />,
      fix: (
        <ul style={{ margin: '4px 0 0', paddingInlineStart: 18 }}>
          {u.missingSeoElements.map((e) => (
            <li key={e}>{SEO_FIX[e] ?? `Add the missing ${SEO_LABEL[e] ?? e}.`}</li>
          ))}
        </ul>
      ),
    })

  if (u.consoleErrorCount > 0 || u.failedRequestCount > 0)
    out.push({
      key: 'js',
      label: 'JavaScript error',
      detail: `${u.consoleErrorCount} console error(s), ${u.failedRequestCount} failed request(s).`,
      color: 'volcano',
      icon: <BugOutlined />,
      fix: 'Open the page, check the browser console, and fix the failing scripts/resources listed below. Broken JavaScript can stop your content or SEO tags from rendering for bots.',
    })

  if (out.length === 0)
    out.push({
      key: 'low',
      label: 'Low health score',
      detail: `Overall page health is ${u.score}/100.`,
      color: 'default',
      icon: <WarningOutlined />,
      fix: 'Review the page against the checks above (content visibility, SEO tags, JS errors) and re-scan after changes.',
    })

  return out
}

export default function BotVisibilityPage() {
  // Reuse the shared dashboard site selection (same state the header uses).
  const { sites, selectedSiteId, setSelectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<ScanJob | null>(null)
  const [data, setData] = useState<DiagSummary | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasActive = useRef(false)

  const jobActive = !!job && (job.status === 'queued' || job.status === 'running')

  const load = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/diagnostics/${siteId}`)
      const json = await res.json()
      setData(
        res.ok
          ? json
          : { domain: '', healthScore: null, urlsChecked: 0, totalRendered: 0, urlsWithIssues: [], topErrors: [], message: json.error }
      )
    } catch {
      setData({ domain: '', healthScore: null, urlsChecked: 0, totalRendered: 0, urlsWithIssues: [], topErrors: [], message: 'Failed to load diagnostics' })
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    if (siteId) load()
  }, [siteId, load])

  // Poll the scan-job status; self-reschedules while active, reloads on finish.
  const poll = useCallback(async () => {
    if (!siteId) return
    try {
      const res = await fetch(`/api/diagnostics/${siteId}/scan-status`)
      const d = await res.json()
      setJob(d.job ?? null)
      const active = !!d.active
      if (wasActive.current && !active) {
        if (d.job?.status === 'failed') message.error(d.job.error_message ?? 'Scan failed')
        else message.success('Scan complete')
        await load()
      }
      wasActive.current = active
      if (active) pollTimer.current = setTimeout(poll, 2500)
    } catch {
      /* transient — resumes on next trigger */
    }
  }, [siteId, load])

  // On site change: reset and discover any in-progress job (resume polling).
  useEffect(() => {
    wasActive.current = false
    setJob(null)
    if (siteId) poll()
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current)
    }
  }, [siteId, poll])

  // Re-scan: ENQUEUE a job (no rendering here), then poll its progress.
  const rescan = useCallback(async () => {
    if (!siteId || jobActive) return // idempotency: ignore while a job is active
    setJob({ id: 'pending', status: 'queued', total_count: 0, done_count: 0 })
    wasActive.current = true
    try {
      const res = await fetch(`/api/diagnostics/${siteId}`, { method: 'POST' })
      const d = await res.json()
      if (!res.ok) {
        message.error(d.error ?? 'Could not start scan')
        setJob(null)
        wasActive.current = false
        return
      }
      setJob(d.job)
      if (pollTimer.current) clearTimeout(pollTimer.current)
      poll()
    } catch {
      message.error('Could not start scan')
      setJob(null)
      wasActive.current = false
    }
  }, [siteId, jobActive, poll])

  const score = data?.healthScore ?? null
  const issues = data?.urlsWithIssues ?? []
  const dist = data?.distribution ?? { good: 0, needsWork: 0, poor: 0 }
  const healthSlices = [
    { label: 'Good', value: dist.good, color: BRAND },
    { label: 'Needs Work', value: dist.needsWork, color: '#faad14' },
    { label: 'Poor', value: dist.poor, color: '#ff4d4f' },
  ]
  const aiScore = data?.aiCitationScore ?? null
  const aiPages = data?.aiPages ?? []

  // Section anchors — clicking a top graph smooth-scrolls to its detail section.
  const issuesRef = useRef<HTMLDivElement>(null)
  const aiRef = useRef<HTMLDivElement>(null)
  const jumpTo = (ref: React.RefObject<HTMLDivElement | null>) =>
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  // Arrow button that opens a URL in a new tab (without toggling the accordion).
  const openBtn = (url: string) => (
    <Tooltip title="Open in new tab">
      <Button
        type="text"
        size="small"
        icon={<ExportOutlined />}
        onClick={(e) => {
          e.stopPropagation()
          window.open(url, '_blank', 'noopener,noreferrer')
        }}
      />
    </Tooltip>
  )

  const tagColorForScore = (s: number | null) =>
    s == null ? 'default' : s >= 70 ? 'green' : s >= 50 ? 'orange' : 'red'

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <div>
          <Title level={3} style={{ margin: 0 }}>
            Bot Visibility
          </Title>
          <Text type="secondary">
            See what AI crawlers and search bots actually see on your pages.
          </Text>
        </div>
        <Space wrap>
          <Select
            placeholder="Select a site"
            style={{ minWidth: 200 }}
            value={siteId}
            onChange={(v) => setSelectedSiteId(v)}
            options={sites.map((s) => ({ value: s.id, label: s.domain }))}
          />
          <Button
            type="primary"
            icon={<ScanOutlined />}
            loading={jobActive}
            onClick={rescan}
            disabled={!siteId || jobActive}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            {jobActive
              ? job!.status === 'queued'
                ? 'Queued…'
                : `Scanning ${job!.done_count}/${job!.total_count}`
              : 'Re-scan'}
          </Button>
        </Space>
      </div>

      {!siteId ? (
        <Card>
          <Empty description="Add a domain and render some pages to see bot visibility." />
        </Card>
      ) : loading && !data ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <>
        {/* ── All scores at the top — click any to jump to its section ──────── */}
        <Row gutter={[16, 16]}>
          {/* SEO Score → Issues */}
          <Col xs={24} md={8}>
            <Card hoverable onClick={() => jumpTo(issuesRef)} style={{ cursor: 'pointer' }}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">SEO Score</Text>
                <div style={{ marginTop: 16 }}>
                  {score == null ? (
                    <div style={{ padding: '36px 0' }}>
                      <Text type="secondary">Re-scan to analyse this domain.</Text>
                    </div>
                  ) : (
                    <Progress
                      type="circle"
                      percent={score}
                      size={160}
                      strokeColor={scoreColor(score)}
                      format={(p) => <span style={{ color: scoreColor(score), fontWeight: 700 }}>{p}</span>}
                    />
                  )}
                </div>
                {score != null && (
                  <div style={{ marginTop: 14 }}>
                    <Tag color={tagColorForScore(score)}>
                      {score >= 70 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor'}
                    </Tag>
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 12, color: BRAND }}>View issues ↓</Text>
                </div>
              </div>
            </Card>
          </Col>

          {/* Page Health donut → Issues */}
          <Col xs={24} md={8}>
            <Card hoverable onClick={() => jumpTo(issuesRef)} style={{ cursor: 'pointer' }}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">Page Health</Text>
                {score == null ? (
                  <div style={{ padding: '36px 0' }}>
                    <Text type="secondary">Re-scan to see the breakdown.</Text>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                    <DonutChart size={150} centerLabel={String(data?.urlsChecked ?? 0)} centerSub="pages" data={healthSlices} />
                    <Legend data={healthSlices} />
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      <b style={{ color: BRAND }}>{data?.healthy ?? 0}</b> of {data?.urlsChecked ?? 0} fully healthy
                    </Text>
                  </div>
                )}
              </div>
            </Card>
          </Col>

          {/* AI Citation Score → AI section */}
          <Col xs={24} md={8}>
            <Card hoverable onClick={() => jumpTo(aiRef)} style={{ cursor: 'pointer' }}>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">AI Citation Score</Text>
                <div style={{ marginTop: 16 }}>
                  {aiScore == null ? (
                    <div style={{ padding: '36px 0' }}>
                      <Text type="secondary">Re-scan to compute readiness.</Text>
                    </div>
                  ) : (
                    <Progress
                      type="circle"
                      percent={aiScore}
                      size={160}
                      strokeColor={scoreColor(aiScore)}
                      format={(p) => <span style={{ color: scoreColor(aiScore), fontWeight: 700 }}>{p}</span>}
                    />
                  )}
                </div>
                {aiScore != null && (
                  <div style={{ marginTop: 14 }}>
                    <Tag color={tagColorForScore(aiScore)}>
                      {aiScore >= 70 ? 'Good' : aiScore >= 50 ? 'Needs Work' : 'Poor'}
                    </Tag>
                  </div>
                )}
                <div style={{ marginTop: 8 }}>
                  <Text style={{ fontSize: 12, color: BRAND }}>View recommendations ↓</Text>
                </div>
              </div>
            </Card>
          </Col>
        </Row>

        {/* ── Issues ────────────────────────────────────────────────────────── */}
        <div ref={issuesRef}>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24}>
            <Card title={`Issues Found${issues.length ? ` (${issues.length})` : ''}`}>
              {issues.length === 0 ? (
                <Empty
                  description={
                    score == null
                      ? 'Run a scan to analyse this domain’s pages.'
                      : 'No issues detected on the analysed pages. 🎉'
                  }
                />
              ) : (
                <Collapse
                  accordion
                  items={issues.map((u) => {
                    const derived = deriveIssues(u)
                    return {
                      key: u.url,
                      label: (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                          <Space size={4} wrap>
                            <Text strong style={{ wordBreak: 'break-all' }}>
                              {u.url}
                            </Text>
                            <Tag color={tagColorForScore(u.score)}>{u.score}/100</Tag>
                            {openBtn(u.url)}
                          </Space>
                          <Space size={[4, 4]} wrap>
                            {derived.map((d) => (
                              <Tag key={d.key} color={d.color} icon={d.icon}>
                                {d.label}
                              </Tag>
                            ))}
                          </Space>
                        </div>
                      ),
                      children: (
                        <div>
                          {derived.map((d) => (
                            <Alert
                              key={d.key}
                              type={d.color === 'red' || d.color === 'volcano' ? 'error' : d.color === 'default' ? 'info' : 'warning'}
                              showIcon
                              icon={d.icon}
                              message={d.label}
                              description={
                                <div>
                                  <div>{d.detail}</div>
                                  <div style={{ marginTop: 6 }}>
                                    <Text strong>How to fix: </Text>
                                    <span>{d.fix}</span>
                                  </div>
                                  {d.action && (
                                    <div style={{ marginTop: 6 }}>
                                      <Link href={d.action.href} style={{ color: BRAND, fontWeight: 600 }}>
                                        {d.action.label} →
                                      </Link>
                                    </div>
                                  )}
                                </div>
                              }
                              style={{ marginBottom: 8 }}
                            />
                          ))}

                          {u.consoleErrors.length > 0 && (
                            <>
                              <Text strong style={{ fontSize: 13 }}>
                                Console errors
                              </Text>
                              <Paragraph>
                                <pre style={preStyle}>{u.consoleErrors.join('\n')}</pre>
                              </Paragraph>
                            </>
                          )}

                          {u.failedRequests.length > 0 && (
                            <>
                              <Text strong style={{ fontSize: 13 }}>
                                Failed requests
                              </Text>
                              <Paragraph>
                                <pre style={preStyle}>
                                  {u.failedRequests
                                    .map((f) => `[${f.resourceType || 'resource'}] ${f.url} — ${f.reason}`)
                                    .join('\n')}
                                </pre>
                              </Paragraph>
                            </>
                          )}

                          <Space size={16} wrap>
                            <a href={u.url} target="_blank" rel="noopener noreferrer">
                              Open URL ↗
                            </a>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Render time: {u.renderTimeMs != null ? `${u.renderTimeMs} ms` : '—'}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              Last analysed: {new Date(u.renderedAt).toLocaleString()}
                            </Text>
                          </Space>
                        </div>
                      ),
                    }
                  })}
                />
              )}
            </Card>
          </Col>
        </Row>
        </div>

        {/* ── AI Citation Readiness ──────────────────────────────────────────── */}
        <div ref={aiRef}>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24}>
            <Card>
              <Title level={4} style={{ margin: 0 }}>
                AI Citation Readiness
              </Title>
              <Text type="secondary">
                Based on Princeton University research — pages with these signals get cited up to 41% more in AI answers.
              </Text>

              <div style={{ marginTop: 16 }}>
                {aiPages.length === 0 ? (
                  <Empty
                    description={
                      aiScore == null
                        ? 'Run a scan to analyse AI citation readiness.'
                        : 'All analysed pages are AI-citation ready. 🎉'
                    }
                  />
                ) : (
                  <Collapse
                    accordion
                    items={aiPages.map((p) => ({
                      key: p.url,
                      label: (
                        <Space size={4} wrap>
                          <Text strong style={{ wordBreak: 'break-all' }}>
                            {p.url}
                          </Text>
                          <Tag color={tagColorForScore(p.aiCitationScore)}>
                            {p.aiCitationScore ?? '—'}/100
                          </Tag>
                          {openBtn(p.url)}
                        </Space>
                      ),
                      // Numbered, clearly-laid-out recommendations.
                      children: (
                        <ol style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                          {p.recommendations.map((rec, i) => (
                            <li key={rec.issue} style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                              <span
                                style={{
                                  flexShrink: 0,
                                  width: 26,
                                  height: 26,
                                  borderRadius: '50%',
                                  background: BRAND,
                                  color: '#fff',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  fontSize: 13,
                                  fontWeight: 700,
                                }}
                              >
                                {i + 1}
                              </span>
                              <div>
                                {/* message — escaped plain text (React children) */}
                                <Text strong>{rec.message}</Text>
                                <div style={{ marginTop: 6 }}>
                                  {/* impact — small highlighted pill */}
                                  <Tag color="green" style={{ fontWeight: 600 }}>
                                    {rec.impact}
                                  </Tag>
                                </div>
                                {/* source — small grey caption */}
                                <Text type="secondary" style={{ fontSize: 12 }}>
                                  Source: {rec.source}
                                </Text>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ),
                    }))}
                  />
                )}
              </div>
            </Card>
          </Col>
        </Row>
        </div>
        </>
      )}
    </div>
  )
}

const preStyle: React.CSSProperties = {
  maxHeight: 200,
  overflow: 'auto',
  background: '#16213e',
  color: '#e6e6e6',
  padding: 12,
  borderRadius: 6,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
}
