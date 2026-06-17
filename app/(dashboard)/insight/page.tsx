'use client'

import { useState } from 'react'
import {
  Row,
  Col,
  Card,
  Button,
  Progress,
  Collapse,
  Tag,
  Table,
  Typography,
  Space,
} from 'antd'
import { ScanOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography

type Severity = 'Critical' | 'Warning' | 'Info'

interface AffectedUrl {
  url: string
  renderTime: number
  fix: string
}

interface Issue {
  key: string
  name: string
  severity: Severity
  urls: AffectedUrl[]
}

const SEVERITY_COLOR: Record<Severity, string> = {
  Critical: 'red',
  Warning: 'orange',
  Info: 'blue',
}

const ISSUES: Issue[] = [
  {
    key: 'title',
    name: 'Missing Title Tags',
    severity: 'Critical',
    urls: [
      { url: '/products/widget-a', renderTime: 820, fix: 'Add a unique <title> under 60 characters' },
      { url: '/blog/launch', renderTime: 640, fix: 'Add a descriptive <title> tag' },
      { url: '/about', renderTime: 510, fix: 'Add a unique <title> tag' },
    ],
  },
  {
    key: 'meta',
    name: 'Missing Meta Descriptions',
    severity: 'Warning',
    urls: [
      { url: '/pricing', renderTime: 720, fix: 'Add a 150–160 char meta description' },
      { url: '/contact', renderTime: 480, fix: 'Add a meta description summarizing the page' },
    ],
  },
  {
    key: 'canonical',
    name: 'Missing Canonical URLs',
    severity: 'Warning',
    urls: [
      { url: '/products?ref=ad', renderTime: 900, fix: 'Add <link rel="canonical"> to the clean URL' },
      { url: '/blog/launch?utm=fb', renderTime: 760, fix: 'Point canonical to /blog/launch' },
    ],
  },
  {
    key: 'og',
    name: 'Missing OG Tags',
    severity: 'Info',
    urls: [
      { url: '/', renderTime: 540, fix: 'Add og:title, og:description, og:image' },
      { url: '/features', renderTime: 610, fix: 'Add Open Graph tags for social sharing' },
    ],
  },
  {
    key: 'slow',
    name: 'Slow Render Times >2s',
    severity: 'Warning',
    urls: [
      { url: '/dashboard-demo', renderTime: 2640, fix: 'Reduce blocking scripts; enable caching' },
      { url: '/gallery', renderTime: 3120, fix: 'Lazy-load images and defer heavy JS' },
    ],
  },
  {
    key: 'jsblock',
    name: 'JavaScript Render Blocking',
    severity: 'Info',
    urls: [
      { url: '/checkout', renderTime: 1980, fix: 'Defer non-critical scripts with async/defer' },
      { url: '/account', renderTime: 1740, fix: 'Move third-party tags to load after paint' },
    ],
  },
]

function scoreColor(score: number) {
  if (score < 50) return '#ff4d4f'
  if (score < 70) return '#faad14'
  return BRAND
}

export default function InsightPage() {
  const [scanning, setScanning] = useState(false)
  const [score, setScore] = useState(64)

  function runScan() {
    setScanning(true)
    // Fake 2s scan.
    setTimeout(() => {
      setScore(Math.floor(50 + Math.random() * 45))
      setScanning(false)
    }, 2000)
  }

  return (
    <div style={{ padding: 24 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
        }}
      >
        <Title level={3} style={{ margin: 0 }}>
          SEO Insights
        </Title>
        <Button
          type="primary"
          icon={<ScanOutlined />}
          loading={scanning}
          onClick={runScan}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          {scanning ? 'Scanning…' : 'Run Scan'}
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        {/* ── SEO score ─────────────────────────────────────────────────────── */}
        <Col xs={24} md={8}>
          <Card>
            <div style={{ textAlign: 'center' }}>
              <Text type="secondary">SEO Score</Text>
              <div style={{ marginTop: 16 }}>
                <Progress
                  type="circle"
                  percent={score}
                  size={180}
                  strokeColor={scoreColor(score)}
                  format={(p) => (
                    <span style={{ color: scoreColor(score), fontWeight: 700 }}>{p}</span>
                  )}
                />
              </div>
              <div style={{ marginTop: 16 }}>
                <Tag color={scoreColor(score) === BRAND ? 'green' : scoreColor(score) === '#faad14' ? 'orange' : 'red'}>
                  {score >= 70 ? 'Good' : score >= 50 ? 'Needs Work' : 'Poor'}
                </Tag>
              </div>
            </div>
          </Card>
        </Col>

        {/* ── Issues ────────────────────────────────────────────────────────── */}
        <Col xs={24} md={16}>
          <Card title="Issues Found">
            <Collapse
              accordion
              items={ISSUES.map((issue) => ({
                key: issue.key,
                label: (
                  <Space>
                    <Tag color={SEVERITY_COLOR[issue.severity]}>{issue.severity}</Tag>
                    <Text strong>{issue.name}</Text>
                    <Text type="secondary">({issue.urls.length} URLs)</Text>
                  </Space>
                ),
                children: (
                  <Table
                    rowKey="url"
                    size="small"
                    pagination={false}
                    dataSource={issue.urls}
                    columns={[
                      { title: 'URL', dataIndex: 'url', ellipsis: true },
                      {
                        title: 'Render Time',
                        dataIndex: 'renderTime',
                        width: 130,
                        render: (v: number) => (
                          <Text type={v > 2000 ? 'danger' : undefined}>{v} ms</Text>
                        ),
                      },
                      { title: 'Fix Suggestion', dataIndex: 'fix' },
                    ]}
                  />
                ),
              }))}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}
