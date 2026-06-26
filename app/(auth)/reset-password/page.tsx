'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Form, Input, Button, Alert, Typography, Spin } from 'antd'
import { LockOutlined, EyeTwoTone, EyeInvisibleOutlined } from '@ant-design/icons'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

const BRAND = '#2da01d'
const { Title, Text } = Typography

// Step 2 of password recovery: the user arrives here from the email link, which
// carries a recovery session (PKCE `?code=` or a recovery token in the URL hash).
// We establish that session, then let them set a new password via updateUser.
export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    let cancelled = false

    // A recovery session may arrive three ways: already established (the JS client
    // auto-detected the URL), a PKCE `?code=` we must exchange, or via the hash
    // flow (handled by detectSessionInUrl → onAuthStateChange below).
    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        if (!cancelled) setStatus('ready')
        return
      }
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }
      // No session and no code yet — give detectSessionInUrl a moment to fire
      // onAuthStateChange (hash flow); otherwise treat the link as invalid.
      setTimeout(() => {
        if (!cancelled) setStatus((s) => (s === 'checking' ? 'invalid' : s))
      }, 1500)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) setStatus('ready')
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  async function onFinish(values: { password: string }) {
    setError(null)
    setLoading(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.updateUser({ password: values.password })
      if (error) {
        setError(error.message)
        return
      }
      setDone(true)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1200)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 400 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          Set a new password
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Choose a strong password for your RenderForAI account.
        </Text>

        {status === 'checking' && (
          <div style={{ textAlign: 'center', padding: '32px 0' }}>
            <Spin />
          </div>
        )}

        {status === 'invalid' && (
          <>
            <Alert
              type="error"
              showIcon
              message="This reset link is invalid or has expired"
              description="Request a new link and try again."
              style={{ marginBottom: 24 }}
            />
            <Link href="/forgot-password" style={{ color: BRAND }}>
              Request a new reset link
            </Link>
          </>
        )}

        {status === 'ready' && (
          <>
            {error && (
              <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />
            )}
            {done ? (
              <Alert type="success" showIcon message="Password updated — signing you in…" />
            ) : (
              <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
                <Form.Item
                  name="password"
                  label="New password"
                  rules={[
                    { required: true, message: 'Enter a new password' },
                    { min: 8, message: 'Use at least 8 characters' },
                  ]}
                  hasFeedback
                >
                  <Input.Password
                    prefix={<LockOutlined />}
                    placeholder="••••••••"
                    iconRender={(v) => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
                  />
                </Form.Item>
                <Form.Item
                  name="confirm"
                  label="Confirm password"
                  dependencies={['password']}
                  hasFeedback
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
                <Button type="primary" htmlType="submit" loading={loading} block style={{ background: BRAND, borderColor: BRAND }}>
                  Update password
                </Button>
              </Form>
            )}
          </>
        )}
      </div>
    </div>
  )
}
