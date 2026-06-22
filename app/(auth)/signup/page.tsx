'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Form, Input, Button, Checkbox, Alert, Divider, Progress } from 'antd'
import {
  UserOutlined,
  MailOutlined,
  LockOutlined,
  EyeTwoTone,
  EyeInvisibleOutlined,
  GoogleOutlined,
} from '@ant-design/icons'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

const BRAND = '#2da01d'

function passwordStrength(pw: string): { percent: number; label: string; color: string } {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  const map = [
    { percent: 0, label: '', color: '#ff4d4f' },
    { percent: 25, label: 'Weak', color: '#ff4d4f' },
    { percent: 50, label: 'Fair', color: '#faad14' },
    { percent: 75, label: 'Good', color: '#52c41a' },
    { percent: 100, label: 'Strong', color: '#2da01d' },
  ]
  return map[score]
}

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pw, setPw] = useState('')

  const strength = passwordStrength(pw)

  async function onFinish(values: { full_name: string; email: string; password: string }) {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: values.full_name,
          email: values.email,
          password: values.password,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Signup failed')
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

  async function signUpWithGoogle() {
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
        className="rf-auth-form-col"
        style={{
          flex: '0 0 60%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
        }}
      >
        <div style={{ width: '100%', maxWidth: 400 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>Create your account</h1>
          <p style={{ color: '#888', marginBottom: 24 }}>Start rendering in minutes</p>

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
              name="full_name"
              label="Full Name"
              rules={[{ required: true, message: 'Enter your name' }]}
            >
              <Input prefix={<UserOutlined />} placeholder="Jane Doe" />
            </Form.Item>

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
              rules={[
                { required: true, message: 'Enter a password' },
                { min: 8, message: 'At least 8 characters' },
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="••••••••"
                onChange={(e) => setPw(e.target.value)}
                iconRender={(v) => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>

            {pw && (
              <div style={{ marginTop: -12, marginBottom: 12 }}>
                <Progress
                  percent={strength.percent}
                  showInfo={false}
                  strokeColor={strength.color}
                  size="small"
                />
                <span style={{ fontSize: 12, color: strength.color }}>{strength.label}</span>
              </div>
            )}

            <Form.Item
              name="confirm"
              label="Confirm Password"
              dependencies={['password']}
              rules={[
                { required: true, message: 'Confirm your password' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve()
                    return Promise.reject(new Error('Passwords do not match'))
                  },
                }),
              ]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="••••••••"
                iconRender={(v) => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
              />
            </Form.Item>

            <Form.Item
              name="terms"
              valuePropName="checked"
              rules={[
                {
                  validator: (_, v) =>
                    v ? Promise.resolve() : Promise.reject(new Error('You must accept the terms')),
                },
              ]}
            >
              <Checkbox>
                I agree to the{' '}
                <Link href="/terms" style={{ color: BRAND }}>
                  Terms of Service
                </Link>
              </Checkbox>
            </Form.Item>

            <Button
              type="primary"
              htmlType="submit"
              loading={loading}
              block
              style={{ background: BRAND, borderColor: BRAND }}
            >
              Create account
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
            onClick={signUpWithGoogle}
          >
            Sign up with Google
          </Button>

          <p style={{ textAlign: 'center', marginTop: 24, color: '#888' }}>
            Already have an account?{' '}
            <Link href="/login" style={{ color: BRAND, fontWeight: 600 }}>
              Sign in
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
  const stats = [
    { num: '10K+', label: 'Sites' },
    { num: '500M+', label: 'Pages Rendered' },
    { num: '99.9%', label: 'Uptime' },
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
      <h2 style={{ color: '#fff', fontSize: 26, fontWeight: 700, lineHeight: 1.3, marginBottom: 40 }}>
        Join 10,000+ websites already using RenderForAI
      </h2>
      <div style={{ display: 'flex', gap: 32 }}>
        {stats.map((s, i) => (
          <div key={i}>
            <div style={{ fontSize: 30, fontWeight: 800, color: '#2da01d' }}>{s.num}</div>
            <div style={{ fontSize: 14, color: '#aab' }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
