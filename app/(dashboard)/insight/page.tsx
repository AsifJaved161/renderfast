'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Row,
  Col,
  Card,
  Button,
  Progress,
  Collapse,
  Tag,
  Table,
  Select,
  Alert,
  Empty,
  Skeleton,
  Typography,
  Space,
} from 'antd'
import { ScanOutlined, GoogleOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography

type Severity = 'Critical' | 'Warning' | 'Info'

interface Issue {
  key: string
  name: string
  severity: Severity
  fix: string
  urls: { url: string; renderTime: number | null }[]
}

interface SeoResult {
  analyzed: number
  htmlAnalyzed: number
  score: number | null
  issues: Issue[]
  message?: string
}

const SEVERITY_COLOR: Record<Severity, string> = {
  Critical: 'red',
  Warning: 'orange',
  Info: 'blue',
}

function scoreColor(score: number) {
  if (score < 50) return '#ff4d4f'
  if (score < 70) return '#faad14'
  return BRAND
}

export default function InsightPage() {
  const [sites, setSites] = useState<{ id: string; domain: string }[]>([])
  const [siteId, setSiteId] = useState<string | undefined>()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<SeoResult | null>(null)
  const [gscConnected, setGscConnected] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/sites')
      .then((r) => r.json())
      .then((d) => {
        const list = d.sites ?? []
        setSites(list)
        setSiteId((prev) => prev ?? list[0]?.id)
      })
      .catch(() => setSites([]))
    fetch('/api/gsc')
      .then((r) => r.json())
      .then((d) => setGscConnected(!!d.connected))
      .catch(() => setGscConnected(false))
  }, [])

  const scan = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/seo?site_id=${siteId}`)
      const data = await res.json()
      setResult(res.ok ? data : { analyzed: 0, htmlAnalyzed: 0, score: null, issues: [], message: data.error })
    } catch {
      setResult({ analyzed: 0, htmlAnalyzed: 0, score: null, issues: [], message: 'Scan failed' })
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    if (siteId) scan()
  }, [siteId, scan])

  const score = result?.score ?? null

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
            loading={loading}
            onClick={scan}
            disabled={!siteId}
            style={{ background: BRAND, borderColor: BRAND }}
          >
            {loading ? 'Scanning…' : 'Re-scan'}
          </Button>
        </Space>
      </div>

      {/* ── Google Search Console connect ───────────────────────────────────── */}
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
      ) : loading && !result ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : result?.message && result.analyzed === 0 ? (
        <Card>
          <Empty description={result.message} />
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
                        HTML content checks need cached pages. Configure rendering & render some URLs.
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
                    Analysed {result?.htmlAnalyzed ?? 0} of {result?.analyzed ?? 0} rendered pages
                  </Text>
                </div>
              </div>
            </Card>
          </Col>

          {/* ── Issues ────────────────────────────────────────────────────── */}
          <Col xs={24} md={16}>
            <Card title={`Issues Found${result?.issues.length ? ` (${result.issues.length})` : ''}`}>
              {!result || result.issues.length === 0 ? (
                <Empty description="No SEO issues detected on the analysed pages. 🎉" />
              ) : (
                <Collapse
                  accordion
                  items={result.issues.map((issue) => ({
                    key: issue.key,
                    label: (
                      <Space>
                        <Tag color={SEVERITY_COLOR[issue.severity]}>{issue.severity}</Tag>
                        <Text strong>{issue.name}</Text>
                        <Text type="secondary">({issue.urls.length} URLs)</Text>
                      </Space>
                    ),
                    children: (
                      <>
                        <Alert type="info" showIcon message={issue.fix} style={{ marginBottom: 12 }} />
                        <Table
                          rowKey="url"
                          size="small"
                          pagination={issue.urls.length > 8 ? { pageSize: 8 } : false}
                          dataSource={issue.urls}
                          columns={[
                            {
                              title: 'URL',
                              dataIndex: 'url',
                              ellipsis: true,
                              render: (u: string) => (
                                <a href={u} target="_blank" rel="noopener noreferrer">
                                  {u}
                                </a>
                              ),
                            },
                            {
                              title: 'Render Time',
                              dataIndex: 'renderTime',
                              width: 130,
                              render: (v: number | null) =>
                                v == null ? '—' : <Text type={v > 2000 ? 'danger' : undefined}>{v} ms</Text>,
                            },
                          ]}
                        />
                      </>
                    ),
                  }))}
                />
              )}
            </Card>
          </Col>
        </Row>
      )}
    </div>
  )
}
