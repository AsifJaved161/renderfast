'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Form, Input, Button, Alert } from 'antd'
import {
  MailOutlined,
  LockOutlined,
  EyeTwoTone,
  EyeInvisibleOutlined,
  ThunderboltFilled,
} from '@ant-design/icons'

const BRAND = '#2da01d'

export default function AdminLoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onFinish(values: { email: string; password: string }) {
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }

      // Verify admin privileges before letting them in.
      const me = await fetch('/api/auth/me').then((r) => r.json())
      if (!me.user?.is_admin) {
        setError("You don't have admin access")
        await fetch('/api/auth/logout', { method: 'POST' })
        return
      }

      router.push('/admin/dashboard')
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0f0f0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 400,
          background: '#1a1a1a',
          border: '1px solid #2a2a2a',
          borderRadius: 12,
          padding: 32,
        }}
      >
        {/* Logo + admin badge */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 18, color: '#fff' }}>
            <ThunderboltFilled style={{ color: BRAND }} />
            Render<span style={{ color: BRAND }}>Fast</span>
          </span>
          <span
            style={{
              background: 'rgba(255,77,79,0.15)',
              color: '#ff4d4f',
              border: '1px solid rgba(255,77,79,0.4)',
              borderRadius: 6,
              padding: '2px 8px',
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 0.5,
            }}
          >
            ADMIN PANEL
          </span>
        </div>

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
            label={<span style={{ color: '#aaa' }}>Email</span>}
            rules={[{ required: true, type: 'email', message: 'Enter a valid email' }]}
          >
            <Input
              prefix={<MailOutlined style={{ color: '#666' }} />}
              placeholder="admin@renderfast.io"
              style={{ background: '#0f0f0f', borderColor: '#2a2a2a', color: '#fff' }}
            />
          </Form.Item>

          <Form.Item
            name="password"
            label={<span style={{ color: '#aaa' }}>Password</span>}
            rules={[{ required: true, message: 'Enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined style={{ color: '#666' }} />}
              placeholder="••••••••"
              style={{ background: '#0f0f0f', borderColor: '#2a2a2a' }}
              iconRender={(v) => (v ? <EyeTwoTone /> : <EyeInvisibleOutlined />)}
            />
          </Form.Item>

          <Button
            htmlType="submit"
            loading={loading}
            block
            style={{
              background: '#0f0f0f',
              color: BRAND,
              border: `1px solid ${BRAND}`,
              fontWeight: 600,
            }}
          >
            Sign In to Admin
          </Button>
        </Form>

        <p style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: '#555' }}>
          Unauthorized access is logged and monitored.
        </p>
      </div>
    </div>
  )
}
