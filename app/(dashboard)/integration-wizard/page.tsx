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
  CloudServerOutlined,
  ApiOutlined,
  AppstoreOutlined,
  DownloadOutlined,
  CopyOutlined,
  EyeTwoTone,
  EyeInvisibleOutlined,
  CheckCircleFilled,
  CloseCircleFilled,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Text, Title } = Typography

// Where integration snippets send crawler traffic.
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://renderforai.com'

type Method = 'wordpress' | 'worker' | 'middleware' | 'script' | 'nginx'

export default function IntegrationWizardPage() {
  const [current, setCurrent] = useState(0)
  const [site, setSite] = useState<{ id: string; domain: string } | null>(null)
  const [method, setMethod] = useState<Method>('wordpress')
  const [apiKey, setApiKey] = useState<string>('')

  // Fetch the API key once so Step 2 snippets can embed it.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => setApiKey(d.user?.api_key ?? ''))
      .catch(() => {})
  }, [])

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
          apiKey={apiKey}
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

// Bot user-agent list shared across all snippets.
const BOT_UA =
  'bot|crawl|spider|googlebot|bingbot|duckduckbot|yandex|baidu|gptbot|oai-searchbot|chatgpt-user|claudebot|anthropic|perplexitybot|amazonbot|applebot|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|whatsapp|discordbot'

// ── Snippet generators (all hit ${APP_URL}/api/proxy with the API key) ────────
function snippetWorker(key: string) {
  return `// Cloudflare Worker — deploy on a Workers Route for your zone (example.com/*)
const PRERENDER = '${APP_URL}/api/proxy'
const TOKEN = '${key || 'YOUR_API_KEY'}'
const BOT = /${BOT_UA}/i
const STATIC = /\\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|map|json|xml|txt|pdf)$/i

export default {
  async fetch(request) {
    const ua = request.headers.get('user-agent') || ''
    const url = new URL(request.url)
    if (request.method === 'GET' && BOT.test(ua) && !STATIC.test(url.pathname)) {
      const r = await fetch(PRERENDER + '?url=' + encodeURIComponent(request.url), {
        headers: { 'User-Agent': ua, 'X-Prerender-Token': TOKEN },
        redirect: 'manual',
      })
      if (r.status === 200) return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'text/html' } })
    }
    return fetch(request)
  },
}`
}

function snippetMiddleware(key: string) {
  return `// middleware.ts — Next.js / Vercel (project root)
import { NextRequest, NextResponse } from 'next/server'

const PRERENDER = '${APP_URL}/api/proxy'
const TOKEN = '${key || 'YOUR_API_KEY'}'
const BOT = /${BOT_UA}/i

export async function middleware(req: NextRequest) {
  const ua = req.headers.get('user-agent') || ''
  if (BOT.test(ua)) {
    const res = await fetch(PRERENDER + '?url=' + encodeURIComponent(req.nextUrl.href), {
      headers: { 'User-Agent': ua, 'X-Prerender-Token': TOKEN },
    })
    const type = res.headers.get('content-type') || ''
    if (res.ok && type.includes('text/html')) {
      return new NextResponse(await res.text(), {
        status: 200,
        headers: { 'content-type': 'text/html; charset=utf-8' },
      })
    }
  }
  return NextResponse.next()
}

// Run on page routes only (skip _next, api, and files with an extension).
export const config = { matcher: ['/((?!_next|api|.*\\\\.).*)'] }`
}

function snippetScript(key: string) {
  return `// Express / Node — add BEFORE your routes
const PRERENDER = '${APP_URL}/api/proxy'
const TOKEN = '${key || 'YOUR_API_KEY'}'
const BOT = /${BOT_UA}/i

app.use(async (req, res, next) => {
  const ua = req.headers['user-agent'] || ''
  if (req.method === 'GET' && BOT.test(ua) && !/\\.\\w{2,4}$/.test(req.path)) {
    try {
      const target = req.protocol + '://' + req.get('host') + req.originalUrl
      const r = await fetch(PRERENDER + '?url=' + encodeURIComponent(target), {
        headers: { 'User-Agent': ua, 'X-Prerender-Token': TOKEN },
      })
      if (r.ok) { res.set('content-type', 'text/html; charset=utf-8'); return res.send(await r.text()) }
    } catch (_) {}
  }
  next()
})

/* ── PHP equivalent (put at the very top of index.php) ──
<?php
$ua = $_SERVER['HTTP_USER_AGENT'] ?? '';
if (preg_match('/${BOT_UA}/i', $ua)) {
  $target = (isset($_SERVER['HTTPS'])?'https':'http').'://'.$_SERVER['HTTP_HOST'].$_SERVER['REQUEST_URI'];
  $ctx = stream_context_create(['http'=>['header'=>"User-Agent: $ua\\r\\nX-Prerender-Token: ${key || 'YOUR_API_KEY'}\\r\\n"]]);
  $html = @file_get_contents('${APP_URL}/api/proxy?url='.urlencode($target), false, $ctx);
  if ($html !== false) { header('Content-Type: text/html; charset=utf-8'); echo $html; exit; }
}
?>
*/`
}

function snippetNginx(key: string) {
  return `# ── Nginx (http {} block) ──
map $http_user_agent $rf_is_bot {
  default 0;
  "~*(${BOT_UA})" 1;
}

# ── inside your server {} ──
location / {
  if ($rf_is_bot) { rewrite ^ /_renderforai last; }
  try_files $uri $uri/ /index.html;   # ← your normal config
}
location /_renderforai {
  internal;
  proxy_set_header X-Prerender-Token ${key || 'YOUR_API_KEY'};
  proxy_set_header User-Agent $http_user_agent;
  proxy_pass ${APP_URL}/api/proxy?url=https://$host$request_uri;
}

# ── Apache .htaccess equivalent (needs mod_proxy + mod_rewrite) ──
# RewriteEngine On
# RewriteCond %{HTTP_USER_AGENT} (${BOT_UA}) [NC]
# RewriteCond %{REQUEST_URI} !\\.(js|css|png|jpe?g|gif|svg|ico|xml|txt|pdf)$ [NC]
# RewriteRule ^(.*)$ ${APP_URL}/api/proxy?url=https://%{HTTP_HOST}%{REQUEST_URI} [P,L]`
}

// ── Step 2 ─────────────────────────────────────────────────────────────────
function StepMethod({
  apiKey,
  method,
  setMethod,
  onBack,
  onNext,
}: {
  domain: string
  apiKey: string
  method: Method
  setMethod: (m: Method) => void
  onBack: () => void
  onNext: () => void
}) {
  const cards: { key: Method; icon: React.ReactNode; title: string; desc: string }[] = [
    { key: 'wordpress', icon: <AppstoreOutlined />, title: 'WordPress', desc: 'One-click plugin' },
    { key: 'worker', icon: <CloudServerOutlined />, title: 'Cloudflare Worker', desc: 'Edge — sites on Cloudflare' },
    { key: 'middleware', icon: <CodeOutlined />, title: 'Next.js / Vercel', desc: 'Drop-in middleware.ts' },
    { key: 'script', icon: <ApiOutlined />, title: 'Universal (Node / PHP)', desc: 'Any backend server' },
    { key: 'nginx', icon: <GlobalOutlined />, title: 'Nginx / Apache', desc: 'VPS / self-hosted' },
  ]

  const isWp = method === 'wordpress'

  const snippet =
    method === 'worker'
      ? snippetWorker(apiKey)
      : method === 'middleware'
      ? snippetMiddleware(apiKey)
      : method === 'script'
      ? snippetScript(apiKey)
      : snippetNginx(apiKey)

  const filename =
    method === 'worker'
      ? 'worker.js'
      : method === 'middleware'
      ? 'middleware.ts'
      : method === 'script'
      ? 'server.js (or index.php)'
      : 'nginx.conf / .htaccess'

  return (
    <Card title="Choose an integration method">
      <Row gutter={16}>
        {cards.map((c) => (
          <Col xs={12} md={c.key === 'wordpress' ? 8 : 4} key={c.key}>
            <Card
              hoverable
              onClick={() => setMethod(c.key)}
              style={{
                marginBottom: 16,
                borderColor: method === c.key ? BRAND : undefined,
                borderWidth: method === c.key ? 2 : 1,
              }}
              styles={{ body: { padding: 16 } }}
            >
              <div style={{ fontSize: 26, color: BRAND }}>{c.icon}</div>
              <Title level={5} style={{ marginTop: 8, marginBottom: 2 }}>
                {c.title}
              </Title>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {c.desc}
              </Text>
            </Card>
          </Col>
        ))}
      </Row>

      {isWp ? (
        <div>
          <Alert
            type="success"
            showIcon
            style={{ marginBottom: 16 }}
            message="Easiest option — no code"
            description="Install the plugin, log in with your RenderForAI email & password inside WordPress, and this domain is connected automatically. Crawlers get prerendered HTML; visitors are untouched."
          />
          <Button
            type="primary"
            size="large"
            icon={<DownloadOutlined />}
            href={`${APP_URL}/renderforai.zip`}
            style={{ background: BRAND, borderColor: BRAND, marginBottom: 16 }}
          >
            Download WordPress plugin
          </Button>
          <ol style={{ paddingLeft: 20, color: '#374151', lineHeight: 2 }}>
            <li>
              WordPress Admin → <Text strong>Plugins → Add New → Upload Plugin</Text> → choose{' '}
              <Text code>renderforai.zip</Text> → Install → Activate.
            </li>
            <li>
              Open the new <Text strong>RenderForAI</Text> menu item.
            </li>
            <li>
              Click <Text strong>Log in &amp; connect</Text> and enter your RenderForAI email &amp;
              password. (No account? Use the <Text strong>Sign up</Text> button there.)
            </li>
            <li>Done — press “Test prerendering” to confirm it’s live.</li>
          </ol>
        </div>
      ) : (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 4 }}
            message="How it works"
            description="The snippet runs on your server/edge, detects crawler User-Agents, and serves them prerendered HTML from RenderForAI. Real visitors are passed straight through to your site — zero impact on them."
          />
          <CodeBlock title={filename} code={snippet} />
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
            title="Test it (renders any URL on demand)"
            code={`curl -X POST ${APP_URL}/api/render \\
  -H "x-api-key: ${visible ? apiKey : 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com"}'`}
          />
          <CodeBlock
            title="Instant recache on publish (call from your CMS/deploy hook)"
            code={`curl -X POST ${APP_URL}/api/recache \\
  -H "x-api-key: ${visible ? apiKey : 'YOUR_API_KEY'}" \\
  -H "Content-Type: application/json" \\
  -d '{"urls":["https://your-domain.com/just-published-post"]}'`}
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
