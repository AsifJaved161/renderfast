'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Form, Input, Button, Alert, Typography } from 'antd'
import { MailOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

const BRAND = '#2da01d'
const { Title, Text } = Typography

// Step 1 of password recovery: email the user a reset link that lands on
// /reset-password (where they set a new password). The link carries a PKCE code
// whose verifier is stored in a cookie by this same browser client.
export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFinish(values: { email: string }) {
    setError(null)
    setLoading(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.resetPasswordForEmail(values.email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      // Always show success — never reveal whether an email is registered.
      if (error && !/rate limit/i.test(error.message)) {
        setError(error.message)
        return
      }
      setSent(true)
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
          Reset your password
        </Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 24 }}>
          Enter your email and we&apos;ll send you a link to set a new password.
        </Text>

        {error && (
          <Alert type="error" message={error} showIcon closable onClose={() => setError(null)} style={{ marginBottom: 16 }} />
        )}

        {sent ? (
          <Alert
            type="success"
            showIcon
            message="Check your email"
            description="If an account exists for that address, a password-reset link is on its way. The link expires after a short while."
            style={{ marginBottom: 24 }}
          />
        ) : (
          <Form layout="vertical" onFinish={onFinish} requiredMark={false} size="large">
            <Form.Item name="email" label="Email" rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}>
              <Input prefix={<MailOutlined />} placeholder="you@example.com" />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block style={{ background: BRAND, borderColor: BRAND }}>
              Send reset link
            </Button>
          </Form>
        )}

        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Link href="/login" style={{ color: BRAND }}>
            <ArrowLeftOutlined /> Back to sign in
          </Link>
        </div>
      </div>
    </div>
  )
}
