'use client'

import { useState } from 'react'
import { Button, Input, Select, Steps } from 'antd'
import { PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { useRouter } from 'next/navigation'

// ─── Wizard steps (same across all wizard pages) ──────────────────────────────
const WIZARD_STEPS = [
  { title: 'Personalisation' },
  { title: 'Invite Team' },
  { title: 'Integrate' },
  { title: 'Verify Integration' },
  { title: 'Start Rendering' },
]

// ─── Role options with descriptions ───────────────────────────────────────────
const ROLES = [
  {
    value: 'account-owner',
    label: 'Account Owner',
    desc: 'The creator of the account. Full access to the dashboard and can invite, edit, or remove users.',
  },
  {
    value: 'admin',
    label: 'Admin',
    desc: 'Full access to the dashboard and can invite, edit, or remove users, except for the Account Owner.',
  },
  {
    value: 'billing-manager',
    label: 'Billing Manager',
    desc: "Full access to the billing menu, but 'View Only' access to the rest of the dashboard. Can invite other Billing Managers and Guests.",
  },
  {
    value: 'team-member',
    label: 'Team Member',
    desc: "Full access to the dashboard, but 'View Only' access to billing and security. Can invite other Team Members and Guests.",
  },
  {
    value: 'guest',
    label: 'Guest',
    desc: "'View Only' access to the entire dashboard.",
  },
]

interface InviteRow {
  id: number
  email: string
  role: string
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function InviteTeamPage() {
  const router = useRouter()
  const [rows, setRows] = useState<InviteRow[]>([
    { id: 1, email: '', role: 'account-owner' },
  ])

  const addRow = () =>
    setRows((prev) => [...prev, { id: Date.now(), email: '', role: '' }])

  const removeRow = (id: number) => {
    if (rows.length === 1) {
      // clear fields on last row instead of removing
      setRows([{ id: 1, email: '', role: '' }])
    } else {
      setRows((prev) => prev.filter((r) => r.id !== id))
    }
  }

  const updateRow = (id: number, field: 'email' | 'role', value: string) =>
    setRows((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    )

  return (
    <div>
      {/* ── Wizard steps bar ────────────────────────────────────────────── */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #f0f0f0',
          borderRadius: 8,
          padding: '20px 32px',
          marginBottom: 40,
        }}
      >
        <Steps
          current={1}
          items={WIZARD_STEPS}
          style={{ maxWidth: 860, margin: '0 auto' }}
        />
      </div>

      {/* ── Page content ────────────────────────────────────────────────── */}
      <div style={{ maxWidth: 740, margin: '0 auto', paddingBottom: 60 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: '#111827',
              marginBottom: 12,
            }}
          >
            Invite your team
          </h1>
          <p style={{ fontSize: 14, color: '#6b7280', maxWidth: 500, margin: '0 auto', lineHeight: 1.6 }}>
            Bring on developers, billing managers, marketers, and more. Add
            unlimited users at no extra costs.
          </p>
        </div>

        {/* Column labels */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 28px',
            gap: 12,
            marginBottom: 8,
          }}
        >
          <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
            <span style={{ color: '#ef4444', marginRight: 2 }}>*</span>
            Email address
          </span>
          <span style={{ fontSize: 13, fontWeight: 500, color: '#374151' }}>
            <span style={{ color: '#ef4444', marginRight: 2 }}>*</span>
            User role
          </span>
          <span />
        </div>

        {/* Invite rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((row) => (
            <div
              key={row.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 28px',
                gap: 12,
                alignItems: 'center',
              }}
            >
              {/* Email */}
              <Input
                placeholder="Email of team member"
                value={row.email}
                onChange={(e) => updateRow(row.id, 'email', e.target.value)}
                style={{ height: 40, borderRadius: 6, fontSize: 13 }}
              />

              {/* Role select */}
              <Select
                value={row.role || undefined}
                placeholder="Select role"
                onChange={(val) => updateRow(row.id, 'role', val)}
                style={{ width: '100%', height: 40 }}
                optionLabelProp="label"
                styles={{ popup: { root: { minWidth: 340, padding: '4px 0' } } }}
                options={ROLES.map((r) => ({
                  value: r.value,
                  label: r.label,
                  desc: r.desc,
                }))}
                optionRender={(option) => (
                  <div style={{ padding: '6px 2px' }}>
                    <div
                      style={{ fontWeight: 600, fontSize: 13, color: '#111827' }}
                    >
                      {option.data.label}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: '#6b7280',
                        marginTop: 3,
                        lineHeight: 1.5,
                      }}
                    >
                      {option.data.desc}
                    </div>
                  </div>
                )}
              />

              {/* Remove row */}
              <button
                type="button"
                onClick={() => removeRow(row.id)}
                title="Remove"
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  padding: 4,
                  color: '#9ca3af',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 4,
                  transition: 'color 0.15s',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.color = '#6b7280')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.color = '#9ca3af')
                }
              >
                <CloseOutlined style={{ fontSize: 16 }} />
              </button>
            </div>
          ))}
        </div>

        {/* Add another */}
        <button
          type="button"
          onClick={addRow}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#2da01d',
            fontWeight: 500,
            fontSize: 13,
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 14,
            padding: '4px 0',
            fontFamily: 'inherit',
          }}
        >
          <PlusOutlined style={{ fontSize: 15 }} />
          Add Another
        </button>

        {/* Submit */}
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 48 }}>
          <Button
            size="large"
            onClick={() => router.push('/integration-wizard/integrate')}
            style={{
              minWidth: 190,
              height: 44,
              borderRadius: 8,
              fontWeight: 600,
              fontSize: 14,
            }}
          >
            Invite Team Members
          </Button>
        </div>
      </div>
    </div>
  )
}
