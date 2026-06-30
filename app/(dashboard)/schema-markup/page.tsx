'use client'

import { useState } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import {
  Row,
  Col,
  Card,
  Button,
  Tag,
  Collapse,
  Select,
  Alert,
  Empty,
  Skeleton,
  Statistic,
  Typography,
  Space,
  Tooltip,
  Modal,
  Input,
  message,
} from 'antd'
import {
  CheckCircleOutlined,
  EditOutlined,
  CloseCircleOutlined,
  CodeOutlined,
  ReloadOutlined,
  InfoCircleOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { StatTitle } from '@/components/ui/StatTitle'
import { useDashboard } from '@/lib/dashboard-context'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

type SchemaType = 'Article' | 'Product' | 'FAQPage' | 'Organization'
type Status = 'pending' | 'approved' | 'rejected' | 'edited'

interface ExtractedField {
  value: unknown
  source: string
}
interface SchemaRow {
  id: string
  url: string
  schema_type: SchemaType
  json_ld: Record<string, unknown>
  edited_json_ld: Record<string, unknown> | null
  extracted_fields: Record<string, ExtractedField>
  confidence: 'high' | 'medium' | 'low'
  status: Status
  changed: boolean
  already_present: boolean
  generated_at: string
  reviewed_at: string | null
}
interface SchemaData {
  domain: string
  schemas: { pending: SchemaRow[]; approved: SchemaRow[]; rejected: SchemaRow[] }
  counts: { pending: number; approved: number; rejected: number; total: number }
}

// ── Display maps ──────────────────────────────────────────────────────────────
const TYPE_COLOR: Record<SchemaType, string> = {
  Article: '#722ed1',
  Product: '#1677ff',
  FAQPage: '#13c2c2',
  Organization: BRAND,
}
const CONFIDENCE_COLOR: Record<SchemaRow['confidence'], string> = { high: 'green', medium: 'gold', low: 'red' }

// Friendly labels for the extractedFields keys (Part 1).
const FIELD_LABEL: Record<string, string> = {
  headline: 'Headline',
  title: 'Title',
  name: 'Name',
  description: 'Description',
  price: 'Price',
  availability: 'Availability',
  image: 'Image',
  datePublished: 'Published',
  author: 'Author',
  wordCount: 'Words',
  type: 'Type',
  questionCount: 'Questions found',
  questions: 'Questions',
  url: 'URL',
  logo: 'Logo',
  sameAs: 'Social links',
}

function shorten(s: string, n = 80): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

// Format a single extracted value for the human-readable summary.
function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return String(value.length)
  if (value == null) return '—'
  return shorten(String(value))
}

// The JSON-LD that will actually be served (client edit wins over auto-generated).
function effectiveJsonLd(row: SchemaRow): Record<string, unknown> {
  return row.edited_json_ld ?? row.json_ld
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return ''
  }
}

// Human-readable field summary ("Title: …", "Price: 49 USD", "Questions found: 4").
function FieldSummary({ fields }: { fields: Record<string, ExtractedField> }) {
  const entries = Object.entries(fields ?? {})
  if (entries.length === 0) return <Text type="secondary">No fields extracted.</Text>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {entries.map(([key, f]) => (
        <div key={key} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <Text strong style={{ minWidth: 130 }}>{FIELD_LABEL[key] ?? key}:</Text>
          <Text>{formatValue(f?.value)}</Text>
          {f?.source && <Text type="secondary" style={{ fontSize: 12 }}>from {f.source}</Text>}
        </div>
      ))}
    </div>
  )
}

// Collapsible raw JSON-LD preview (nested inside the page accordion).
function JsonPreview({ row }: { row: SchemaRow }) {
  return (
    <Collapse
      ghost
      items={[
        {
          key: 'json',
          label: <Space size={6}><CodeOutlined /> View raw JSON-LD</Space>,
          children: (
            <pre style={preStyle}>{JSON.stringify(effectiveJsonLd(row), null, 2)}</pre>
          ),
        },
      ]}
    />
  )
}

export default function SchemaMarkupPage() {
  const { sites, selectedSiteId, setSelectedSiteId } = useDashboard()
  const siteId = selectedSiteId ?? undefined

  const { data, isLoading, mutate } = useSWR<SchemaData>(siteId ? `/api/schema/${siteId}` : null)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SchemaRow | null>(null)
  const [editText, setEditText] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  // Approve / reject a row.
  async function act(row: SchemaRow, action: 'approve' | 'reject') {
    if (!siteId) return
    setBusyId(row.id)
    try {
      const res = await fetch(`/api/schema/${siteId}/${row.id}/${action}`, { method: 'POST' })
      if (res.ok) {
        message.success(action === 'approve' ? 'Approved — schema is now live' : 'Rejected — schema won’t be served')
        await mutate()
      } else {
        const d = await res.json().catch(() => ({}))
        message.error(d.error ?? 'Action failed')
      }
    } finally {
      setBusyId(null)
    }
  }

  function openEdit(row: SchemaRow) {
    setEditing(row)
    setEditText(JSON.stringify(effectiveJsonLd(row), null, 2))
  }

  // Save the edited JSON-LD (status → edited, served like approved).
  async function saveEdit() {
    if (!editing || !siteId) return
    let parsed: unknown
    try {
      parsed = JSON.parse(editText)
    } catch {
      message.error('That isn’t valid JSON — check for a missing comma or quote.')
      return
    }
    setSavingEdit(true)
    try {
      const res = await fetch(`/api/schema/${siteId}/${editing.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ json_ld: parsed }),
      })
      if (res.ok) {
        message.success('Saved & approved — your edited schema is now live')
        setEditing(null)
        await mutate()
      } else {
        const d = await res.json().catch(() => ({}))
        message.error(d.error ?? 'Save failed')
      }
    } finally {
      setSavingEdit(false)
    }
  }

  // ── Header (always shown) ───────────────────────────────────────────────────
  const header = (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
      <div>
        <Title level={3} style={{ margin: 0 }}>
          <CodeOutlined style={{ color: BRAND, marginRight: 8 }} />
          Schema Markup
        </Title>
        <Text type="secondary">
          We automatically detect missing structured data and generate it from your page content. Review and approve before it goes live.
        </Text>
      </div>
      <Select
        placeholder="Select a site"
        style={{ minWidth: 220 }}
        value={siteId}
        onChange={(v) => setSelectedSiteId(v)}
        options={sites.map((s) => ({ value: s.id, label: s.name || s.domain }))}
      />
    </div>
  )

  if (!siteId) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <Card><Empty description="Select a site to review its generated schema markup." /></Card>
      </div>
    )
  }

  if (isLoading && !data) {
    return (
      <div style={{ padding: 24 }}>
        {header}
        <Card><Skeleton active paragraph={{ rows: 6 }} /></Card>
      </div>
    )
  }

  const pending = data?.schemas.pending ?? []
  const approved = data?.schemas.approved ?? []
  const rejected = data?.schemas.rejected ?? []
  // Active = approved/edited that we actually inject; "already present" = the
  // page already ships its own JSON-LD of that type, so we don't modify it.
  const active = approved.filter((r) => !r.already_present)
  const alreadyPresent = approved.filter((r) => r.already_present)
  const total = data?.counts.total ?? 0

  // ── Shared row header (the accordion label) ─────────────────────────────────
  const rowHeader = (row: SchemaRow) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Space size={6} wrap>
        <Tag color={TYPE_COLOR[row.schema_type]} style={{ margin: 0 }}>{row.schema_type}</Tag>
        <Tag color={CONFIDENCE_COLOR[row.confidence]} style={{ margin: 0 }}>{row.confidence} confidence</Tag>
        {row.status === 'edited' && <Tag color="purple" style={{ margin: 0 }}>edited</Tag>}
        {row.changed && <Tag icon={<WarningOutlined />} color="orange" style={{ margin: 0 }}>content changed</Tag>}
      </Space>
      <Text style={{ wordBreak: 'break-all', fontSize: 13 }}>{row.url}</Text>
    </div>
  )

  // ── Pending review item ─────────────────────────────────────────────────────
  const pendingItems = pending.map((row) => ({
    key: row.id,
    label: rowHeader(row),
    children: (
      <div>
        {row.changed && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="The page content changed since this was last reviewed"
            description="We regenerated the schema from the new content — please re-review before it goes live again."
          />
        )}
        <FieldSummary fields={row.extracted_fields} />
        <JsonPreview row={row} />
        <Space wrap style={{ marginTop: 8 }}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={busyId === row.id} onClick={() => act(row, 'approve')} style={{ background: BRAND, borderColor: BRAND }}>
            Approve
          </Button>
          <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>Edit</Button>
          <Button danger icon={<CloseCircleOutlined />} loading={busyId === row.id} onClick={() => act(row, 'reject')}>
            Reject
          </Button>
        </Space>
      </div>
    ),
  }))

  // ── Active (live) item ──────────────────────────────────────────────────────
  const activeItems = active.map((row) => ({
    key: row.id,
    label: rowHeader(row),
    children: (
      <div>
        <Alert
          type="success"
          showIcon
          icon={<CheckCircleOutlined />}
          style={{ marginBottom: 12 }}
          message={`Live on your site${row.reviewed_at ? ` since ${fmtDate(row.reviewed_at)}` : ''}`}
          description="This structured data is served to bots and visitors on this page."
        />
        <FieldSummary fields={row.extracted_fields} />
        <JsonPreview row={row} />
        <Space wrap style={{ marginTop: 8 }}>
          <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>Edit</Button>
          <Button danger icon={<CloseCircleOutlined />} loading={busyId === row.id} onClick={() => act(row, 'reject')}>
            Stop serving
          </Button>
        </Space>
      </div>
    ),
  }))

  // ── Rejected item (re-approvable) ───────────────────────────────────────────
  const rejectedItems = rejected.map((row) => ({
    key: row.id,
    label: rowHeader(row),
    children: (
      <div>
        <FieldSummary fields={row.extracted_fields} />
        <JsonPreview row={row} />
        <Space wrap style={{ marginTop: 8 }}>
          <Button type="primary" icon={<CheckCircleOutlined />} loading={busyId === row.id} onClick={() => act(row, 'approve')} style={{ background: BRAND, borderColor: BRAND }}>
            Approve instead
          </Button>
          <Button icon={<EditOutlined />} onClick={() => openEdit(row)}>Edit</Button>
        </Space>
      </div>
    ),
  }))

  return (
    <div style={{ padding: 24 }}>
      {header}

      {/* ── Summary ──────────────────────────────────────────────────────────── */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} lg={6}>
          <Card><Statistic title={<StatTitle hint="Pages where we detected a schema type and generated structured data.">Schemas Generated</StatTitle>} value={total} prefix={<CodeOutlined style={{ color: BRAND }} />} /></Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card><Statistic title={<StatTitle hint="Generated schemas waiting for your review before they go live.">Pending Review</StatTitle>} value={pending.length} valueStyle={{ color: pending.length ? '#faad14' : undefined }} /></Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card><Statistic title={<StatTitle hint="Approved schemas currently injected into your pages for bots & visitors.">Active (Live)</StatTitle>} value={active.length} valueStyle={{ color: active.length ? BRAND : undefined }} prefix={<CheckCircleOutlined style={{ color: BRAND }} />} /></Card>
        </Col>
        <Col xs={12} lg={6}>
          <Card><Statistic title={<StatTitle hint="Pages that already ship their own structured data of this type — we leave those untouched.">Already on Page</StatTitle>} value={alreadyPresent.length} /></Card>
        </Col>
      </Row>

      {total === 0 ? (
        <Card>
          <Empty
            description={
              <span>
                No schema generated yet. Run a <Link href="/bot-visibility" style={{ color: BRAND, fontWeight: 600 }}>Bot Visibility scan</Link> so we can analyze your pages and generate structured data.
              </span>
            }
          />
        </Card>
      ) : (
        <>
          {/* ── Pending review ─────────────────────────────────────────────────── */}
          <Card title={<StatTitle hint="Newly generated structured data. Approve, edit, or reject each before it goes live.">Pending Review ({pending.length})</StatTitle>} style={{ marginBottom: 16 }}>
            {pending.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing waiting for review. 🎉" />
            ) : (
              <Collapse accordion items={pendingItems} />
            )}
          </Card>

          {/* ── Active / live ──────────────────────────────────────────────────── */}
          {active.length > 0 && (
            <Card title={<StatTitle hint="Approved structured data currently served on your pages.">Active — Live on Your Site ({active.length})</StatTitle>} style={{ marginBottom: 16 }}>
              <Collapse accordion items={activeItems} />
            </Card>
          )}

          {/* ── Already present on page ────────────────────────────────────────── */}
          {alreadyPresent.length > 0 && (
            <Card title={<StatTitle hint="These pages already include their own structured data of the same type, so we don’t inject or modify anything.">Already on Your Page — Not Modified ({alreadyPresent.length})</StatTitle>} style={{ marginBottom: 16 }}>
              <Alert
                type="info"
                showIcon
                icon={<InfoCircleOutlined />}
                style={{ marginBottom: 12 }}
                message="No changes made to these pages"
                description="Your page already includes valid structured data of this type. To avoid duplicate markup, we leave it exactly as-is and don’t inject our own."
              />
              <Space direction="vertical" style={{ width: '100%' }} size={8}>
                {alreadyPresent.map((row) => (
                  <div key={row.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
                    <Tag color={TYPE_COLOR[row.schema_type]} style={{ margin: 0 }}>{row.schema_type}</Tag>
                    <Text style={{ wordBreak: 'break-all', flex: 1, fontSize: 13 }}>{row.url}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>already present</Text>
                  </div>
                ))}
              </Space>
            </Card>
          )}

          {/* ── Rejected (collapsed by default) ────────────────────────────────── */}
          {rejected.length > 0 && (
            <Card style={{ marginBottom: 16 }}>
              <Collapse
                items={[
                  {
                    key: 'rejected',
                    label: (
                      <Space>
                        <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
                        <Text strong>Rejected ({rejected.length})</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>not served — reopen any time</Text>
                      </Space>
                    ),
                    children: <Collapse accordion items={rejectedItems} />,
                  },
                ]}
              />
            </Card>
          )}
        </>
      )}

      {/* ── Edit modal ───────────────────────────────────────────────────────── */}
      <Modal
        open={!!editing}
        title={editing ? `Edit ${editing.schema_type} JSON-LD` : 'Edit JSON-LD'}
        onCancel={() => setEditing(null)}
        okText="Save & Approve"
        okButtonProps={{ loading: savingEdit, style: { background: BRAND, borderColor: BRAND } }}
        onOk={saveEdit}
        width={760}
      >
        <Paragraph type="secondary" style={{ marginTop: 0 }}>
          Edit the JSON-LD below. It’s validated as JSON before saving; once saved it goes live on this page.
        </Paragraph>
        <Input.TextArea
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          autoSize={{ minRows: 14, maxRows: 28 }}
          spellCheck={false}
          style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 12.5 }}
        />
      </Modal>
    </div>
  )
}

const preStyle: React.CSSProperties = {
  maxHeight: 360,
  overflow: 'auto',
  background: '#16213e',
  color: '#e6e6e6',
  padding: 12,
  borderRadius: 6,
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-all',
  margin: 0,
}
