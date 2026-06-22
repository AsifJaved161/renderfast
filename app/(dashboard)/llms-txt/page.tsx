'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Button,
  Alert,
  Empty,
  Skeleton,
  Typography,
  Space,
  Tag,
  Collapse,
  Input,
  message,
} from 'antd'
import {
  ReloadOutlined,
  ExportOutlined,
  FileTextOutlined,
  EditOutlined,
  CheckCircleOutlined,
} from '@ant-design/icons'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"

interface LlmsData {
  domain: string
  content: string
  generatedAt: string
  autoEnabled: boolean
  url: string
}

// llms.txt — a low-friction "it's already done for you" page. RenderForAI
// auto-generates and serves the file; the only action a client needs is an
// optional "Regenerate now". Manual editing is tucked away under Advanced.
export default function LlmsTxtPage() {
  const { selectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const [data, setData] = useState<LlmsData | null>(null)
  const [loading, setLoading] = useState(false)
  const [regenerating, setRegenerating] = useState(false)
  const [savingManual, setSavingManual] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const load = useCallback(async () => {
    if (!siteId) return
    setLoading(true)
    try {
      const res = await fetch(`/api/llms-txt/${siteId}`)
      const d: LlmsData = await res.json()
      setData(res.ok ? d : null)
      if (res.ok) setEditValue(d.content)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    load()
  }, [load])

  async function regenerate() {
    if (!siteId) return
    setRegenerating(true)
    try {
      const res = await fetch(`/api/llms-txt/${siteId}/regenerate`, { method: 'POST' })
      if (!res.ok) {
        message.error('Regeneration failed')
        return
      }
      const d = await res.json()
      setData((prev) => ({ ...(prev as LlmsData), ...d, autoEnabled: true }))
      setEditValue(d.content)
      message.success('llms.txt regenerated')
    } finally {
      setRegenerating(false)
    }
  }

  async function saveManual() {
    if (!siteId) return
    if (!editValue.trim()) {
      message.error('Content cannot be empty')
      return
    }
    setSavingManual(true)
    try {
      const res = await fetch(`/api/llms-txt/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editValue }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        message.error(e.error ?? 'Save failed')
        return
      }
      const d = await res.json()
      setData((prev) => ({ ...(prev as LlmsData), ...d }))
      message.success('Manual version saved — automatic updates are now paused')
    } finally {
      setSavingManual(false)
    }
  }

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 16 }}>
        <Title level={3} style={{ margin: 0 }}>
          <Space>
            <FileTextOutlined style={{ color: BRAND }} /> llms.txt
          </Space>
        </Title>
        <Text type="secondary">
          We automatically generate and serve an llms.txt file so AI systems can understand your
          site structure.
        </Text>
      </div>

      {!siteId ? (
        <Card>
          <Empty description="Select a site to view its llms.txt." />
        </Card>
      ) : loading && !data ? (
        <Card>
          <Skeleton active paragraph={{ rows: 6 }} />
        </Card>
      ) : !data ? (
        <Card>
          <Empty description="Couldn’t load llms.txt for this site." />
        </Card>
      ) : (
        <>
          {/* ── Status + live URL ───────────────────────────────────────────── */}
          <Card style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <Space direction="vertical" size={4}>
                <Space size={8}>
                  <Text strong>Live at</Text>
                  <a href={data.url} target="_blank" rel="noopener noreferrer" style={{ color: BRAND, fontFamily: MONO }}>
                    {data.url.replace(/^https?:\/\//, '')}/llms.txt <ExportOutlined style={{ fontSize: 12 }} />
                  </a>
                </Space>
                <Space size={8}>
                  {data.autoEnabled ? (
                    <Tag icon={<CheckCircleOutlined />} color="green">Auto-managed</Tag>
                  ) : (
                    <Tag icon={<EditOutlined />} color="orange">Manual override</Tag>
                  )}
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    Last generated: {mounted ? new Date(data.generatedAt).toLocaleString() : '…'}
                  </Text>
                </Space>
              </Space>

              <Button
                type="primary"
                icon={<ReloadOutlined />}
                loading={regenerating}
                onClick={regenerate}
                style={{ background: BRAND, borderColor: BRAND }}
              >
                Regenerate now
              </Button>
            </div>

            {!data.autoEnabled && (
              <Alert
                type="warning"
                showIcon
                style={{ marginTop: 12 }}
                message="Automatic updates are paused"
                description="You’re serving a manually-edited version. Click “Regenerate now” to rebuild from your pages and switch back to automatic."
              />
            )}
          </Card>

          {/* ── Read-only preview ───────────────────────────────────────────── */}
          <Card title="Current content" style={{ marginBottom: 16 }}>
            <pre
              style={{
                margin: 0,
                padding: 16,
                background: '#f6f8fa',
                border: '1px solid #eaecef',
                borderRadius: 8,
                fontFamily: MONO,
                fontSize: 12.5,
                lineHeight: 1.6,
                maxHeight: 460,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {data.content}
            </pre>
          </Card>

          {/* ── Advanced: manual edit (collapsed by default) ────────────────── */}
          <Collapse
            ghost
            items={[
              {
                key: 'advanced',
                label: (
                  <Space>
                    <EditOutlined />
                    <Text strong>Advanced: edit manually</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>(optional — automatic is recommended)</Text>
                  </Space>
                ),
                children: (
                  <Card>
                    <Paragraph type="secondary" style={{ marginTop: 0 }}>
                      Most sites never need this. Editing manually pauses automatic regeneration so
                      your custom content is preserved — use “Regenerate now” above to return to the
                      automatic version at any time.
                    </Paragraph>
                    <Input.TextArea
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      autoSize={{ minRows: 10, maxRows: 24 }}
                      style={{ fontFamily: MONO, fontSize: 12.5 }}
                      spellCheck={false}
                    />
                    <Space style={{ marginTop: 12 }}>
                      <Button
                        icon={<EditOutlined />}
                        loading={savingManual}
                        onClick={saveManual}
                      >
                        Save manual version
                      </Button>
                      <Button type="text" onClick={() => setEditValue(data.content)} disabled={editValue === data.content}>
                        Reset to current
                      </Button>
                    </Space>
                  </Card>
                ),
              },
            ]}
          />
        </>
      )}
    </div>
  )
}
