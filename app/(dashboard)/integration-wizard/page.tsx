'use client'

import { useState, useEffect } from 'react'
import {
  Steps,
  Card,
  Form,
  Input,
  Button,
  Row,
  Col,
  message,
  Alert,
  Typography,
  Result,
  Spin,
} from 'antd'
import {
  GlobalOutlined,
  CodeOutlined,
  AppstoreOutlined,
  CopyOutlined,
  EyeTwoTone,
  EyeInvisibleOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
  DownloadOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Paragraph, Text, Title } = Typography

type Method = 'dns' | 'middleware' | 'wordpress'

export default function IntegrationWizardPage() {
  const [current, setCurrent] = useState(0)
  const [site, setSite] = useState<{ id: string; domain: string } | null>(null)
  const [method, setMethod] = useState<Method>('dns')
  const [apiKey, setApiKey] = useState<string>('')

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      <Title level={3}>Integration Wizard</Title>
      <Steps
        current={current}
        style={{ margin: '24px 0 32px' }}
        items={[
          { title: 'Add Domain' },
          { title: 'Integration' },
          { title: 'API Key' },
          { title: 'Verify' },
        ]}
      />

      {current === 0 && (
        <StepDomain
          onNext={(s) => {
            setSite(s)
            setCurrent(1)
          }}
        />
      )}
      {current === 1 && (
        <StepMethod
          domain={site?.domain ?? 'your-domain.com'}
          method={method}
          setMethod={setMethod}
          onBack={() => setCurrent(0)}
          onNext={() => setCurrent(2)}
        />
      )}
      {current === 2 && (
        <StepApiKey
          apiKey={apiKey}
          setApiKey={setApiKey}
          onBack={() => setCurrent(1)}
          onNext={() => setCurrent(3)}
        />
      )}
      {current === 3 && (
        <StepVerify domain={site?.domain ?? ''} onBack={() => setCurrent(2)} />
      )}
    </div>
  )
}

// ── Step 1 ─────────────────────────────────────────────────────────────────
function StepDomain({ onNext }: { onNext: (s: { id: string; domain: string }) => void }) {
  const [loading, setLoading] = useState(false)

  async function onFinish(values: { domain: string; name: string }) {
    setLoading(true)
    try {
      const res = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain: values.domain, name: values.name }),
      })
      const data = await res.json()
      if (!res.ok) {
        message.error(data.error ?? 'Failed to add domain')
        return
      }
      message.success('Domain added')
      onNext({ id: data.site.id, domain: data.site.domain })
    } catch {
      message.error('Network error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="Add your domain">
      <Form layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="domain"
          label="Domain"
          rules={[
            { required: true, message: 'Enter your domain' },
            {
              pattern: /^([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/,
              message: 'Enter a bare domain like example.com',
            },
          ]}
        >
          <Input prefix={<GlobalOutlined />} placeholder="example.com" size="large" />
        </Form.Item>
        <Form.Item name="name" label="Site Name" rules={[{ required: true, message: 'Enter a name' }]}>
          <Input placeholder="My Marketing Site" size="large" />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          Continue
        </Button>
      </Form>
    </Card>
  )
}

// ── Step 2 ─────────────────────────────────────────────────────────────────
function StepMethod({
  domain,
  method,
  setMethod,
  onBack,
  onNext,
}: {
  domain: string
  method: Method
  setMethod: (m: Method) => void
  onBack: () => void
  onNext: () => void
}) {
  const cards: { key: Method; icon: React.ReactNode; title: string; desc: string }[] = [
    { key: 'dns', icon: <GlobalOutlined />, title: 'DNS Proxy', desc: 'Point a CNAME at RenderFast' },
    { key: 'middleware', icon: <CodeOutlined />, title: 'Next.js Middleware', desc: 'Drop-in middleware.ts' },
    { key: 'wordpress', icon: <AppstoreOutlined />, title: 'WordPress Plugin', desc: 'Install our plugin' },
  ]

  return (
    <Card title="Choose an integration method">
      <Row gutter={16}>
        {cards.map((c) => (
          <Col xs={24} md={8} key={c.key}>
            <Card
              hoverable
              onClick={() => setMethod(c.key)}
              style={{
                marginBottom: 16,
                borderColor: method === c.key ? BRAND : undefined,
                borderWidth: method === c.key ? 2 : 1,
              }}
            >
              <div style={{ fontSize: 28, color: BRAND }}>{c.icon}</div>
              <Title level={5} style={{ marginTop: 8 }}>
                {c.title}
              </Title>
              <Text type="secondary">{c.desc}</Text>
            </Card>
          </Col>
        ))}
      </Row>

      <div style={{ marginTop: 16 }}>
        {method === 'dns' && (
          <Alert
            type="info"
            showIcon
            message="Add this CNAME record at your DNS provider"
            description={
              <Paragraph copyable={{ text: `${domain} CNAME proxy.renderfast.io` }} style={{ marginBottom: 0 }}>
                <Text code>{domain}</Text> → <Text code>proxy.renderfast.io</Text>
              </Paragraph>
            }
          />
        )}
        {method === 'middleware' && (
          <CodeBlock
            title="middleware.ts"
            code={`import { NextResponse } from 'next/server'

export async function middleware(req) {
  const ua = req.headers.get('user-agent') || ''
  const isBot = /googlebot|bingbot|gptbot|claudebot|perplexitybot/i.test(ua)
  if (isBot) {
    return NextResponse.rewrite(
      'https://proxy.renderfast.io/api/proxy?url=' +
        encodeURIComponent(req.url)
    )
  }
  return NextResponse.next()
}`}
          />
        )}
        {method === 'wordpress' && (
          <div>
            <Button
              type="primary"
              icon={<DownloadOutlined />}
              href="/wp-plugin.zip"
              style={{ background: BRAND, borderColor: BRAND, marginBottom: 12 }}
            >
              Download Plugin
            </Button>
            <ol style={{ paddingLeft: 20, color: '#555' }}>
              <li>Go to WordPress Admin → Plugins → Add New → Upload Plugin</li>
              <li>Upload the downloaded <Text code>wp-plugin.zip</Text></li>
              <li>Activate, then paste your API key in RenderFast settings</li>
            </ol>
          </div>
        )}
      </div>

      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={onNext} style={{ background: BRAND, borderColor: BRAND }}>
          Continue
        </Button>
      </div>
    </Card>
  )
}

// ── Step 3 ─────────────────────────────────────────────────────────────────
function StepApiKey({
  apiKey,
  setApiKey,
  onBack,
  onNext,
}: {
  apiKey: string
  setApiKey: (k: string) => void
  onBack: () => void
  onNext: () => void
}) {
  const [loading, setLoading] = useState(!apiKey)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (apiKey) return
    ;(async () => {
      try {
        const res = await fetch('/api/auth/me')
        const data = await res.json()
        setApiKey(data.user?.api_key ?? '')
      } finally {
        setLoading(false)
      }
    })()
  }, [apiKey, setApiKey])

  const masked = apiKey ? apiKey.slice(0, 6) + '••••••••••••••••' : ''

  function copy() {
    navigator.clipboard.writeText(apiKey)
    message.success('API key copied')
  }

  return (
    <Card title="Your API Key">
      {loading ? (
        <Spin />
      ) : (
        <>
          <Input
            size="large"
            readOnly
            value={visible ? apiKey : masked}
            addonAfter={
              <span style={{ display: 'inline-flex', gap: 12 }}>
                <span onClick={() => setVisible((v) => !v)} style={{ cursor: 'pointer' }}>
                  {visible ? <EyeInvisibleOutlined /> : <EyeTwoTone />}
                </span>
                <span onClick={copy} style={{ cursor: 'pointer' }}>
                  <CopyOutlined />
                </span>
              </span>
            }
          />
          <CodeBlock
            title="Example request"
            code={`curl -X POST https://proxy.renderfast.io/api/render \\
  -H "x-api-key: ${visible ? apiKey : 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`}
          />
        </>
      )}
      <div style={{ marginTop: 24, display: 'flex', justifyContent: 'space-between' }}>
        <Button onClick={onBack}>Back</Button>
        <Button type="primary" onClick={onNext} style={{ background: BRAND, borderColor: BRAND }}>
          Continue
        </Button>
      </div>
    </Card>
  )
}

// ── Step 4 ─────────────────────────────────────────────────────────────────
function StepVerify({ domain, onBack }: { domain: string; onBack: () => void }) {
  const [status, setStatus] = useState<'idle' | 'testing' | 'success' | 'fail'>('idle')
  const [detail, setDetail] = useState('')

  async function testNow() {
    setStatus('testing')
    try {
      const url = domain ? `https://${domain}` : 'https://example.com'
      const res = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, {
        headers: {
          'user-agent':
            'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        },
      })
      if (res.ok) {
        setStatus('success')
        setDetail(`Bot request handled (${res.headers.get('X-Cache-Status') ?? 'OK'})`)
      } else {
        setStatus('fail')
        setDetail(`Server responded with ${res.status}`)
      }
    } catch (e) {
      setStatus('fail')
      setDetail(e instanceof Error ? e.message : 'Request failed')
    }
  }

  return (
    <Card title="Verify integration">
      {status === 'idle' && (
        <Result
          icon={<GlobalOutlined style={{ color: BRAND }} />}
          title="Ready to test"
          subTitle="We'll send a request as Googlebot to confirm prerendering works."
          extra={
            <Button type="primary" onClick={testNow} style={{ background: BRAND, borderColor: BRAND }}>
              Test Now
            </Button>
          }
        />
      )}
      {status === 'testing' && <Result icon={<Spin size="large" />} title="Testing…" />}
      {status === 'success' && (
        <Result
          icon={<CheckCircleFilled style={{ color: BRAND }} />}
          status="success"
          title="Integration working!"
          subTitle={detail}
          extra={<Button onClick={() => setStatus('idle')}>Run again</Button>}
        />
      )}
      {status === 'fail' && (
        <Result
          icon={<CloseCircleFilled style={{ color: '#ff4d4f' }} />}
          status="error"
          title="Verification failed"
          subTitle={detail}
          extra={
            <Button type="primary" danger onClick={testNow}>
              Retry
            </Button>
          }
        />
      )}
      <div style={{ marginTop: 8 }}>
        <Button onClick={onBack}>Back</Button>
      </div>
    </Card>
  )
}

// ── Shared code block with copy button ───────────────────────────────────────
function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div style={{ marginTop: 16 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          background: '#1a1a2e',
          color: '#aaa',
          padding: '6px 12px',
          borderRadius: '8px 8px 0 0',
          fontSize: 12,
        }}
      >
        <span>{title}</span>
        <Button
          size="small"
          type="text"
          icon={<CopyOutlined style={{ color: '#aaa' }} />}
          onClick={() => {
            navigator.clipboard.writeText(code)
            message.success('Copied')
          }}
        />
      </div>
      <pre
        style={{
          margin: 0,
          background: '#16213e',
          color: '#e6e6e6',
          padding: 16,
          borderRadius: '0 0 8px 8px',
          overflowX: 'auto',
          fontSize: 13,
          lineHeight: 1.5,
        }}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
