'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, Table, Segmented, Button, Tag, Typography, Space, Skeleton, Alert, message } from 'antd'
import { SaveOutlined, LockOutlined } from '@ant-design/icons'
import { PLAN_ORDER, PLAN_LABEL, type FeatureAccessMap } from '@/lib/feature-access'
import type { Plan } from '@/lib/supabase'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

interface FeatureDef {
  key: string
  label: string
  defaultMinPlan: Plan
}

const PLAN_COLOR: Record<Plan, string> = { free: 'default', starter: 'blue', pro: 'green', agency: 'gold' }

export default function FeatureAccessPage() {
  const [features, setFeatures] = useState<FeatureDef[]>([])
  const [access, setAccess] = useState<FeatureAccessMap>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/feature-access')
      const d = await res.json()
      setFeatures(d.features ?? [])
      setAccess(d.access ?? {})
    } catch {
      message.error('Failed to load feature access')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/feature-access', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access }),
      })
      if (res.ok) {
        const d = await res.json()
        setAccess(d.access ?? access)
        message.success('Feature access saved')
      } else message.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const setPlan = (key: string, plan: Plan) => setAccess((prev) => ({ ...prev, [key]: plan }))

  if (loading) return <Skeleton active paragraph={{ rows: 10 }} />

  return (
    <div style={{ maxWidth: 900 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <LockOutlined style={{ color: BRAND, marginRight: 8 }} />
        Feature Access by Plan
      </Title>
      <Paragraph type="secondary">
        Choose the minimum plan required for each dashboard feature. A user whose plan is below the
        required tier still sees the page in their sidebar, but its content appears <b>blurred</b> with an
        upgrade prompt. Account pages (Billing, Settings, Team…) are always accessible.
      </Paragraph>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="Tip"
        description="Set a feature to “Free” to make it available on every plan, or to a higher tier (Starter / Pro / Agency) to lock it behind that plan and above."
      />

      <Card>
        <Table<FeatureDef>
          rowKey="key"
          pagination={false}
          dataSource={features}
          columns={[
            {
              title: 'Feature',
              dataIndex: 'label',
              render: (label: string, row) => (
                <Space direction="vertical" size={0}>
                  <Text strong>{label}</Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>{row.key}</Text>
                </Space>
              ),
            },
            {
              title: 'Available from plan',
              dataIndex: 'key',
              width: 420,
              render: (key: string) => (
                <Segmented
                  value={access[key] ?? 'free'}
                  onChange={(v) => setPlan(key, v as Plan)}
                  options={PLAN_ORDER.map((p) => ({ value: p, label: PLAN_LABEL[p] }))}
                />
              ),
            },
            {
              title: 'Unlocked on',
              dataIndex: 'key',
              width: 120,
              render: (key: string) => {
                const plan = (access[key] ?? 'free') as Plan
                return <Tag color={PLAN_COLOR[plan]}>{PLAN_LABEL[plan]}+</Tag>
              },
            },
          ]}
        />
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={save}
          style={{ background: BRAND, borderColor: BRAND, marginTop: 16 }}
        >
          Save feature access
        </Button>
      </Card>
    </div>
  )
}
