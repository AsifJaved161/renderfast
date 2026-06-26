'use client'

import { useEffect, useState } from 'react'
import useSWR from 'swr'
import {
  Form,
  Input,
  Button,
  Typography,
  Divider,
  Row,
  Col,
  Skeleton,
  message,
} from 'antd'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

const BRAND = '#2da01d'
const { Title, Text } = Typography

// Phone has no column on the profile yet, so it persists client-side only.
const PHONE_KEY = 'rf:phone'

interface Profile {
  email: string
  full_name: string | null
  company_name: string | null
}

export default function AccountPage() {
  const [companyForm] = Form.useForm()
  const [userForm] = Form.useForm()

  const [savingCompany, setSavingCompany] = useState(false)
  const [savingUser, setSavingUser] = useState(false)
  const [sendingReset, setSendingReset] = useState(false)

  // Profile via SWR — cached, so revisiting the page hydrates the forms instantly.
  const { data, isLoading: loading, error } = useSWR<{ user: Profile }>('/api/auth/me')
  const profile = data?.user
  const email = profile?.email ?? ''

  useEffect(() => {
    if (error) message.error('Could not load your account')
  }, [error])

  // Hydrate both forms once the profile arrives (and again if it revalidates).
  useEffect(() => {
    if (!profile) return
    const [first = '', ...rest] = (profile.full_name ?? '').trim().split(/\s+/)
    let phone = ''
    try {
      phone = localStorage.getItem(PHONE_KEY) ?? ''
    } catch {
      /* ignore */
    }
    companyForm.setFieldsValue({
      adminEmail: profile.email ?? '',
      companyName: profile.company_name ?? '',
    })
    userForm.setFieldsValue({
      firstName: first,
      lastName: rest.join(' '),
      email: profile.email ?? '',
      phone,
    })
  }, [profile, companyForm, userForm])

  async function patchProfile(updates: Record<string, unknown>): Promise<boolean> {
    const res = await fetch('/api/user', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    return res.ok
  }

  async function onSaveCompany(values: { companyName: string }) {
    setSavingCompany(true)
    try {
      const ok = await patchProfile({ company_name: values.companyName || null })
      ok ? message.success('Company details updated') : message.error('Update failed')
    } finally {
      setSavingCompany(false)
    }
  }

  async function onSaveUser(values: { firstName: string; lastName: string; phone: string }) {
    setSavingUser(true)
    try {
      const fullName = [values.firstName, values.lastName].filter(Boolean).join(' ').trim()
      const ok = await patchProfile({ full_name: fullName || null })
      try {
        if (values.phone) localStorage.setItem(PHONE_KEY, values.phone)
        else localStorage.removeItem(PHONE_KEY)
      } catch {
        /* ignore */
      }
      ok ? message.success('User details saved') : message.error('Save failed')
    } finally {
      setSavingUser(false)
    }
  }

  async function changePassword() {
    if (!email) return
    setSendingReset(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      error
        ? message.error(error.message)
        : message.success(`Password reset link sent to ${email}`)
    } catch {
      message.error('Could not send reset link')
    } finally {
      setSendingReset(false)
    }
  }

  if (loading) {
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <Skeleton active paragraph={{ rows: 8 }} />
      </div>
    )
  }

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      {/* ── Company Settings ────────────────────────────────────────────────── */}
      <Title level={4} style={{ marginTop: 0 }}>
        Company Settings
      </Title>
      <Form form={companyForm} layout="vertical" requiredMark={false} onFinish={onSaveCompany}>
        <Form.Item
          name="adminEmail"
          label="Admin email"
          extra="This is the primary contact email for us to reach you. Many of the automated notifications will be sent to this address."
        >
          <Input disabled />
        </Form.Item>
        <Form.Item
          name="companyName"
          label="Company name"
          extra="Name of your company."
          rules={[{ required: true, message: 'Enter your company name' }]}
        >
          <Input placeholder="Acme Inc." />
        </Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={savingCompany}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          Change Company Details
        </Button>
        <div style={{ marginTop: 8 }}>
          <Text type="secondary">You must be an account owner to change your information.</Text>
        </div>
      </Form>

      {/* ── User Details ────────────────────────────────────────────────────── */}
      <Title level={4} style={{ marginTop: 32 }}>
        User Details
      </Title>
      <Form form={userForm} layout="vertical" requiredMark={false} onFinish={onSaveUser}>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="firstName"
              label="First name"
              rules={[{ required: true, message: 'Enter your first name' }]}
            >
              <Input placeholder="Jane" />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item name="lastName" label="Last name">
              <Input placeholder="Doe" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} sm={12}>
            <Form.Item
              name="email"
              label="Your email"
              extra="This is what you use to log in to your account."
            >
              <Input disabled />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12}>
            <Form.Item
              name="phone"
              label="Phone number"
              extra="Phone number in international format."
            >
              <Input placeholder="+1 555 000 1234" />
            </Form.Item>
          </Col>
        </Row>
        <Button
          type="primary"
          htmlType="submit"
          loading={savingUser}
          style={{ background: BRAND, borderColor: BRAND }}
        >
          Save User Details
        </Button>
      </Form>

      <Divider />

      {/* ── Update Your Password ────────────────────────────────────────────── */}
      <Title level={4}>Update Your Password</Title>
      <Text type="secondary">
        We&apos;ll email you a secure link to reset your password and manage how you sign in.
      </Text>
      <div style={{ marginTop: 16 }}>
        <Button loading={sendingReset} onClick={changePassword}>
          Change Password
        </Button>
      </div>
    </div>
  )
}
