'use client'

import { useState } from 'react'
import { Row, Col, Card, Button, Alert, Typography, Progress, List, Tag, Space } from 'antd'
import {
  GoogleOutlined,
  FileSearchOutlined,
  WarningOutlined,
  LineChartOutlined,
  ToolOutlined,
} from '@ant-design/icons'
import { DonutChart, Legend } from '@/components/charts/Charts'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

const FEATURES = [
  { icon: <FileSearchOutlined />, title: 'Indexing Status', desc: 'See which pages Google has indexed' },
  { icon: <WarningOutlined />, title: 'Crawl Errors', desc: 'Catch 404s and server errors early' },
  { icon: <LineChartOutlined />, title: 'Search Performance', desc: 'Clicks, impressions & average position' },
  { icon: <ToolOutlined />, title: 'Auto-fix Suggestions', desc: 'Actionable fixes for SEO issues' },
]

export default function GscPage() {
  const [connecting, setConnecting] = useState(false)
  const [comingSoon, setComingSoon] = useState(false)

  async function connect() {
    setConnecting(true)
    try {
      await fetch('/api/gsc')
      // OAuth not wired yet — surface the placeholder state.
      setComingSoon(true)
    } finally {
      setConnecting(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <Title level={3}>Google Search Console</Title>

      {/* ── Connect card ────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 24 }}>
        <Row align="middle" gutter={24}>
          <Col flex="auto">
            <Space align="start" size={16}>
              <GoogleOutlined style={{ fontSize: 40, color: '#4285F4' }} />
              <div>
                <Title level={4} style={{ margin: 0 }}>
                  Connect Google Search Console
                </Title>
                <Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                  Link your GSC property to surface indexing status, crawl errors, and search
                  performance right inside RenderFast.
                </Paragraph>
              </div>
            </Space>
          </Col>
          <Col>
            <Button
              type="primary"
              icon={<GoogleOutlined />}
              loading={connecting}
              onClick={connect}
              style={{ background: BRAND, borderColor: BRAND }}
            >
              Connect GSC
            </Button>
          </Col>
        </Row>
        {comingSoon && (
          <Alert
            style={{ marginTop: 16 }}
            type="info"
            showIcon
            message="Coming Soon"
            description="Google Search Console integration is on its way. We'll notify you when it's ready."
            closable
            onClose={() => setComingSoon(false)}
          />
        )}
      </Card>

      {/* ── Locked preview with glassmorphism overlay ───────────────────────── */}
      <div style={{ position: 'relative', marginBottom: 24 }}>
        <div style={{ filter: 'blur(3px)', opacity: 0.5, pointerEvents: 'none', userSelect: 'none' }}>
          <Row gutter={[16, 16]}>
            <Col xs={24} md={8}>
              <Card title="Indexing Status">
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                  <DonutChart
                    centerLabel="842"
                    centerSub="indexed"
                    data={[
                      { label: 'Indexed', value: 842, color: BRAND },
                      { label: 'Excluded', value: 120, color: '#faad14' },
                      { label: 'Errors', value: 38, color: '#ff4d4f' },
                    ]}
                  />
                  <Legend
                    data={[
                      { label: 'Indexed', value: 842, color: BRAND },
                      { label: 'Excluded', value: 120, color: '#faad14' },
                      { label: 'Errors', value: 38, color: '#ff4d4f' },
                    ]}
                  />
                </div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card title="Pages to Fix">
                <List
                  size="small"
                  dataSource={[
                    { url: '/products/old-item', issue: '404 Not Found' },
                    { url: '/blog/draft', issue: 'Excluded by noindex' },
                    { url: '/category/legacy', issue: 'Redirect error' },
                    { url: '/checkout', issue: 'Crawled, not indexed' },
                  ]}
                  renderItem={(item) => (
                    <List.Item>
                      <Text ellipsis style={{ flex: 1 }}>
                        {item.url}
                      </Text>
                      <Tag color="red">{item.issue}</Tag>
                    </List.Item>
                  )}
                />
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card title="Crawl Budget">
                <Statistic label="Crawl requests / day" value="12,480" />
                <Progress percent={72} strokeColor={BRAND} style={{ marginTop: 12 }} />
                <Text type="secondary">72% of daily crawl budget used</Text>
                <Statistic label="Avg response time" value="318 ms" />
              </Card>
            </Col>
          </Row>
        </div>

        {/* Glassmorphism lock overlay */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.35)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
            borderRadius: 8,
          }}
        >
          <Card style={{ textAlign: 'center', maxWidth: 360, boxShadow: '0 8px 30px rgba(0,0,0,0.12)' }}>
            <GoogleOutlined style={{ fontSize: 32, color: '#4285F4' }} />
            <Title level={5} style={{ marginTop: 12 }}>
              Connect Google Search Console to unlock these insights
            </Title>
            <Button
              type="primary"
              icon={<GoogleOutlined />}
              loading={connecting}
              onClick={connect}
              style={{ background: BRAND, borderColor: BRAND, marginTop: 8 }}
            >
              Connect GSC
            </Button>
          </Card>
        </div>
      </div>

      {/* ── Feature list ────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]}>
        {FEATURES.map((f) => (
          <Col xs={24} sm={12} lg={6} key={f.title}>
            <Card>
              <div style={{ fontSize: 28, color: BRAND, marginBottom: 8 }}>{f.icon}</div>
              <Title level={5} style={{ margin: 0 }}>
                {f.title}
              </Title>
              <Text type="secondary">{f.desc}</Text>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  )
}

// Small labeled stat used in the locked preview (kept local to this page).
function Statistic({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <Text type="secondary" style={{ display: 'block', fontSize: 12 }}>
        {label}
      </Text>
      <Text strong style={{ fontSize: 20 }}>
        {value}
      </Text>
    </div>
  )
}
