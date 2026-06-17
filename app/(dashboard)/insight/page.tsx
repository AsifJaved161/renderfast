'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
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
  message,
} from 'antd'
import {
  ScanOutlined,
  GoogleOutlined,
  EyeInvisibleOutlined,
  TagsOutlined,
  BugOutlined,
  CloseCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

// Content-diff threshold above which a page counts as "hidden from crawlers".
const CONTENT_DIFF_THRESHOLD = 20

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

interface DiagSummary {
  domain: string
  healthScore: number | null
  urlsChecked: number
  totalRendered: number
  urlsWithIssues: UrlIssue[]
  topErrors: { message: string; count: number }[]
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

// Derive the human-readable issues shown for one URL.
function deriveIssues(u: UrlIssue) {
  const out: { key: string; label: string; detail: string; color: string; icon: React.ReactNode }[] = []
  if (!u.renderSucceeded)
    out.push({
      key: 'render',
      label: 'Render failed',
      detail: 'Page render did not complete — main content may be empty.',
      color: 'red',
      icon: <CloseCircleOutlined />,
    })
  if (u.contentDiffPercentage > CONTENT_DIFF_THRESHOLD)
    out.push({
      key: 'content',
      label: 'Content hidden from AI bots/crawlers',
      detail: `${u.contentDiffPercentage}% of content invisible to crawlers (only appears after JS).`,
      color: 'orange',
      icon: <EyeInvisibleOutlined />,
    })
  if (u.missingSeoElements.length > 0)
    out.push({
      key: 'seo',
      label: 'Missing SEO tag',
      detail: `Missing: ${u.missingSeoElements.map((e) => SEO_LABEL[e] ?? e).join(', ')}`,
      color: 'gold',
      icon: <TagsOutlined />,
    })
  if (u.consoleErrorCount > 0 || u.failedRequestCount > 0)
    out.push({
      key: 'js',
      label: 'JavaScript error',
      detail: `${u.consoleErrorCount} console error(s), ${u.failedRequestCount} failed request(s).`,
      color: 'volcano',
      icon: <BugOutlined />,
    })
  if (out.length === 0)
    out.push({
      key: 'low',
      label: 'Low health score',
      detail: `Overall page health is ${u.score}/100.`,
      color: 'default',
      icon: <WarningOutlined />,
    })
  return out
}

export default function InsightPage() {
  const [sites, setSites] = useState<{ id: string; domain: string }[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [job, setJob] = useState<ScanJob | null>(null)
  const [data, setData] = useState<DiagSummary | null>(null)
  const [gscConnected, setGscConnected] = useState<boolean | null>(null)
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wasActive = useRef(false)

  const jobActive = !!job && (job.status === 'queued' || job.status === 'running')

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const list = d.sites ?? []
        setSites(list)
        setSiteId((prev) => prev ?? list[0]?.id)
      })
      .catch(() => setSites([]))
    // GSC banner — separate feature, untouched.
    fetch('/api/gsc')
      .then((r) => r.json())
      .then((d) => setGscConnected(!!d.connected))
      .catch(() => setGscConnected(false))
  }, [])

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

  // Poll the scan-job status; self-reschedules while a job is active, and reloads
  // the summary once a job transitions from active → finished.
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
      /* transient — will resume on next trigger */
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
    // Optimistic disable immediately on click.
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

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          SEO Insights
        </Title>
        <Space wrap>
          <Select
            placeholder="Select a site"
            style={{ minWidth: 200 }}
            value={siteId}
            onChange={setSiteId}
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

      {/* ── Google Search Console connect (separate feature — untouched) ─────── */}
      {gscConnected === false && (
        <Alert
          type="info"
          showIcon
          icon={<GoogleOutlined />}
          style={{ marginBottom: 16 }}
          message="Connect Google Search Console for richer insights"
          description={
            <span>
              Impressions, clicks, average position and indexing status will appear here once
              GSC is connected.{' '}
              <Link href="/gsc" style={{ color: BRAND, fontWeight: 600 }}>
                Connect now →
              </Link>
            </span>
          }
        />
      )}

      {!siteId ? (
        <Card>
          <Empty description="Add a domain and render some pages to see SEO insights." />
        </Card>
      ) : loading && !data ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {/* ── SEO score ─────────────────────────────────────────────────── */}
          <Col xs={24} md={8}>
            <Card>
              <div style={{ textAlign: 'center' }}>
                <Text type="secondary">SEO Score</Text>
                <div style={{ marginTop: 16 }}>
                  {score == null ? (
                    <div style={{ padding: '40px 0' }}>
                      <Text type="secondary">
                        No rendered pages analysed yet. Click <b>Re-scan</b> to render this domain’s
                        URLs and analyse them.
                      </Text>
                    </div>
                  ) : (
                    <Progress
                      type="circle"
                      percent={score}
                      size={180}
                      strokeColor={scoreColor(score)}
                      format={(p) => <span style={{ color: scoreColor(score), fontWeight: 700 }}>{p}</span>}
                    />
                  )}
                </div>
                {score != null && (
                  <div style={{ marginTop: 16 }}>
                    <Tag color={score >= 70 ? 'green' : score >= 50 ? 'orange' : 'red'}>
                      {score >= 70 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor'}
                    </Tag>
                  </div>
                )}
                <div style={{ marginTop: 12 }}>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Analysed {data?.urlsChecked ?? 0} of {data?.totalRendered ?? 0} rendered pages
                  </Text>
                </div>
              </div>
            </Card>
          </Col>

          {/* ── Issues ────────────────────────────────────────────────────── */}
          <Col xs={24} md={16}>
            <Card title={`Issues Found${issues.length ? ` (${issues.length})` : ''}`}>
              {issues.length === 0 ? (
                <Empty
                  description={
                    score == null
                      ? 'Run a scan to analyse this domain’s pages.'
                      : 'No SEO issues detected on the analysed pages. 🎉'
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
                            <Tag color={scoreColor(u.score) === BRAND ? 'green' : scoreColor(u.score) === '#faad14' ? 'orange' : 'red'}>
                              {u.score}/100
                            </Tag>
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
                          {/* Per-issue human-readable details */}
                          {derived.map((d) => (
                            <Alert
                              key={d.key}
                              type={d.color === 'red' || d.color === 'volcano' ? 'error' : d.color === 'default' ? 'info' : 'warning'}
                              showIcon
                              icon={d.icon}
                              message={d.label}
                              description={d.detail}
                              style={{ marginBottom: 8 }}
                            />
                          ))}

                          {/* Raw console errors */}
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

                          {/* Raw failed requests */}
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
