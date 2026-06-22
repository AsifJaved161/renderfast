'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Form, Input, Button, Checkbox, Alert, Divider } from 'antd'
import {
  MailOutlined,
  LockOutlined,
  EyeTwoTone,
  EyeInvisibleOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  AppstoreOutlined,
  GoogleOutlined,
} from '@ant-design/icons'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

const BRAND = '#2da01d'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFinish(values: { email: string; password: string }) {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: values.email, password: values.password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function signInWithGoogle() {
    setGoogleLoading(true)
    const supabase = getSupabaseBrowser()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/api/auth/callback` },
    })
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      {/* ── Left: form (60%) ─────────────────────────────────────────────── */}
      <div
        style={{
          flex: '0 0 60%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
        className="rf-auth-form-col"
      >
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Welcome back</h1>
          <p style={{ color: '#888', marginBottom: 24 }}>Sign in to your RenderForAI account</p>

          {error && (
            <Alert
              type="error"
              message={error}
              showIcon
              closable
              onClose={() => setError(null)}
              style={{ marginBottom: 16 }}
            />
          )}

          <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
            <Form.Item
              name="email"
              label="Email"
              rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}
            >
              <Input prefix={<MailOutlined />} placeholder="you@example.com" />
            </Form.Item>

            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: 'Enter your password' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="••••••••"
                iconRender={(v) => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
              <Form.Item name="remember" valuePropName="checked" noStyle>
                <Checkbox>Remember me</Checkbox>
              </Form.Item>
              <Link href="/forgot-password" style={{ color: BRAND }}>
                Forgot password?
              </Link>
            </div>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ background: BRAND, borderColor: BRAND }}
            >
              Sign in
            </Button>
          </Form>

          <Divider plain style={{ color: '#aaa' }}>
            or
          </Divider>

          <Button
            icon={<GoogleOutlined />}
            block
            size="large"
            loading={googleLoading}
            onClick={signInWithGoogle}
          >
            Sign in with Google
          </Button>

          <p style={{ textAlign: 'center', marginTop: 24, color: '#888' }}>
            Don&apos;t have an account?{' '}
            <Link href="/signup" style={{ color: BRAND, fontWeight: 600 }}>
              Sign up
            </Link>
          </p>
        </div>
      </div>

      {/* ── Right: brand panel (40%) ─────────────────────────────────────── */}
      <BrandPanel />

      <style>{`
        @media (max-width: 768px) {
          .rf-auth-form-col { flex: 1 1 100% !important; }
          .rf-auth-brand-col { display: none !important; }
        }
      `}</style>
    </div>
  )
}

function BrandPanel() {
  const features = [
    { icon: <ThunderboltOutlined />, text: 'Lightning-fast prerendering' },
    { icon: <RobotOutlined />, text: 'AI bot support (GPTBot, ClaudeBot, Perplexity)' },
    { icon: <AppstoreOutlined />, text: 'One-click WordPress plugin' },
  ]
  return (
    <div
      className="rf-auth-brand-col"
      style={{
        flex: '0 0 40%',
        background: 'linear-gradient(160deg, #1a1a2e 0%, #16213e 100%)',
        color: '#fff',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        padding: '48px',
      }}
    >
      <div style={{ fontSize: 32, fontWeight: 800, marginBottom: 24 }}>
        Render<span style={{ color: '#2da01d' }}>ForAI</span>
      </div>
      <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 700, lineHeight: 1.3, marginBottom: 32 }}>
        Make your SPA visible to every search engine
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        {features.map((f, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span
              style={{
                fontSize: 20,
                color: '#2da01d',
                background: 'rgba(45,160,29,0.15)',
                width: 40,
                height: 40,
                borderRadius: 10,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {f.icon}
            </span>
            <span style={{ fontSize: 16, color: '#d0d4dc' }}>{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
