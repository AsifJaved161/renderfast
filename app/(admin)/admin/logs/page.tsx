'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Select,
  Button,
  Tag,
  Typography,
  Space,
  DatePicker,
  Alert,
  Descriptions,
  Empty,
  message,
} from 'antd'
import { ExportOutlined, LockOutlined, InfoCircleOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs from 'dayjs'

const BRAND = '#2da01d'
const { Title, Text } = Typography
const { RangePicker } = DatePicker

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface AuditLog {
  id: string
  timestamp: string
  admin_email: string
  action: string
  target_type: string
  target_id: string
  details: Record<string, unknown> | null
  ip_address: string | null
}

/* ── Action colours ────────────────────────────────────────────────────────── */

const ACTION_COLOR: Record<string, string> = {
  ban_user: 'red',
  unban_user: 'green',
  delete_user: 'red',
  delete_site: 'red',
  delete_render: 'red',
  change_plan: 'blue',
  impersonate: 'orange',
  update_user: 'cyan',
  reset_renders: 'purple',
  create_plan: 'geekblue',
  update_plan: 'blue',
  delete_plan: 'red',
  update_subscription: 'blue',
  cancel_subscription: 'volcano',
  login: 'green',
  logout: 'default',
}

function actionColor(action: string): string {
  return ACTION_COLOR[action] ?? 'default'
}

/* ── Known options for filters ─────────────────────────────────────────────── */

const ACTION_OPTIONS = [
  'ban_user',
  'unban_user',
  'delete_user',
  'delete_site',
  'delete_render',
  'change_plan',
  'impersonate',
  'update_user',
  'reset_renders',
  'create_plan',
  'update_plan',
  'delete_plan',
  'update_subscription',
  'cancel_subscription',
  'login',
  'logout',
].map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))

const TARGET_TYPE_OPTIONS = [
  'user',
  'site',
  'render',
  'plan',
  'subscription',
  'session',
].map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))

/* ── Details renderer (old → new diffs) ────────────────────────────────────── */

function DetailsView({ details }: { details: Record<string, unknown> | null }) {
  if (!details || Object.keys(details).length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No additional details" />
  }

  // If the details contain old_value / new_value, render a diff view
  const hasOldNew = 'old_value' in details && 'new_value' in details

  if (hasOldNew) {
    const oldVal = details.old_value as Record<string, unknown> | null
    const newVal = details.new_value as Record<string, unknown> | null
    const allKeys = Array.from(
      new Set([...Object.keys(oldVal ?? {}), ...Object.keys(newVal ?? {})])
    )

    return (
      <div style={{ padding: '8px 0' }}>
        <Text strong style={{ fontSize: 13, color: '#6b7280', display: 'block', marginBottom: 8 }}>
          Changes
        </Text>
        <Descriptions
          column={1}
          size="small"
          bordered
          labelStyle={{ width: 160, color: '#6b7280', fontSize: 12 }}
          contentStyle={{ fontSize: 12 }}
        >
          {allKeys.map((key) => {
            const ov = (oldVal as Record<string, unknown>)?.[key]
            const nv = (newVal as Record<string, unknown>)?.[key]
            const changed = JSON.stringify(ov) !== JSON.stringify(nv)
            return (
              <Descriptions.Item key={key} label={key}>
                <Space direction="vertical" size={2}>
                  {ov !== undefined && (
                    <div>
                      <Tag
                        color="red"
                        style={{
                          fontSize: 11,
                          padding: '0 4px',
                          lineHeight: '18px',
                          marginRight: 6,
                        }}
                      >
                        OLD
                      </Tag>
                      <Text
                        delete={changed}
                        type="secondary"
                        style={{ fontSize: 12 }}
                      >
                        {typeof ov === 'object' ? JSON.stringify(ov) : String(ov)}
                      </Text>
                    </div>
                  )}
                  {nv !== undefined && (
                    <div>
                      <Tag
                        color="green"
                        style={{
                          fontSize: 11,
                          padding: '0 4px',
                          lineHeight: '18px',
                          marginRight: 6,
                        }}
                      >
                        NEW
                      </Tag>
                      <Text style={{ fontSize: 12, color: changed ? BRAND : undefined }}>
                        {typeof nv === 'object' ? JSON.stringify(nv) : String(nv)}
                      </Text>
                    </div>
                  )}
                </Space>
              </Descriptions.Item>
            )
          })}
        </Descriptions>
      </div>
    )
  }

  // Generic key-value display
  return (
    <Descriptions
      column={1}
      size="small"
      bordered
      labelStyle={{ width: 180, color: '#6b7280', fontSize: 12 }}
      contentStyle={{ fontSize: 12 }}
    >
      {Object.entries(details).map(([key, value]) => (
        <Descriptions.Item key={key} label={key}>
          {typeof value === 'object' && value !== null
            ? JSON.stringify(value, null, 2)
            : String(value ?? '—')}
        </Descriptions.Item>
      ))}
    </Descriptions>
  )
}

/* ── Main page ─────────────────────────────────────────────────────────────── */

export default function AdminLogsPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)

  // Filters
  const [adminEmail, setAdminEmail] = useState<string | undefined>()
  const [actionType, setActionType] = useState<string | undefined>()
  const [targetType, setTargetType] = useState<string | undefined>()
  const [dateRange, setDateRange] = useState<[dayjs.Dayjs, dayjs.Dayjs] | null>(null)

  // Admin list for dropdown
  const [adminList, setAdminList] = useState<{ value: string; label: string }[]>([])

  const LIMIT = 25

  /* ── Fetch admin list once ──────────────────────────────────────────────── */
  useEffect(() => {
    fetch('/api/admin/logs?distinct_admins=true')
      .then((r) => r.json())
      .then((d) => {
        const admins: string[] = d.admins ?? []
        setAdminList(admins.map((email) => ({ value: email, label: email })))
      })
      .catch(() => {})
  }, [])

  /* ── Fetch logs ─────────────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(LIMIT),
      })
      if (adminEmail) params.set('admin_email', adminEmail)
      if (actionType) params.set('action', actionType)
      if (targetType) params.set('target_type', targetType)
      if (dateRange) {
        params.set('from', dateRange[0].startOf('day').toISOString())
        params.set('to', dateRange[1].endOf('day').toISOString())
      }

      const res = await fetch(`/api/admin/logs?${params}`)
      const json = await res.json()
      setRows(json.logs ?? [])
      setTotal(json.total ?? 0)
    } catch {
      message.error('Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }, [page, adminEmail, actionType, targetType, dateRange])

  useEffect(() => {
    load()
  }, [load])

  /* ── Export CSV ──────────────────────────────────────────────────────────── */
  function exportCsv() {
    const header = ['Timestamp', 'Admin', 'Action', 'Target Type', 'Target ID', 'Details', 'IP Address']
    const lines = rows.map((log) =>
      [
        log.timestamp,
        log.admin_email,
        log.action,
        log.target_type,
        log.target_id,
        log.details ? JSON.stringify(log.details) : '',
        log.ip_address ?? '',
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `audit-logs-${dayjs().format('YYYY-MM-DD-HHmmss')}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  /* ── Table columns ──────────────────────────────────────────────────────── */
  const columns: ColumnsType<AuditLog> = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      width: 190,
      render: (ts: string) => (
        <Text style={{ fontSize: 13, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
          {dayjs(ts).format('YYYY-MM-DD HH:mm:ss')}
        </Text>
      ),
    },
    {
      title: 'Admin',
      dataIndex: 'admin_email',
      width: 220,
      ellipsis: true,
      render: (email: string) => (
        <Text style={{ fontSize: 13 }}>{email}</Text>
      ),
    },
    {
      title: 'Action',
      dataIndex: 'action',
      width: 170,
      render: (action: string) => (
        <Tag
          color={actionColor(action)}
          style={{ fontSize: 12, textTransform: 'capitalize' }}
        >
          {action.replace(/_/g, ' ')}
        </Tag>
      ),
    },
    {
      title: 'Target',
      width: 260,
      render: (_, log) => (
        <Space size={4}>
          <Tag style={{ fontSize: 11, opacity: 0.7 }}>
            {log.target_type}
          </Tag>
          <Text
            copyable={{ text: log.target_id }}
            style={{ fontSize: 13, maxWidth: 180 }}
            ellipsis
          >
            {log.target_id}
          </Text>
        </Space>
      ),
    },
    {
      title: 'IP Address',
      dataIndex: 'ip_address',
      width: 140,
      render: (ip: string | null) => (
        <Text type="secondary" style={{ fontSize: 12, fontFamily: 'monospace' }}>
          {ip ?? '—'}
        </Text>
      ),
    },
  ]

  /* ── Render ─────────────────────────────────────────────────────────────── */
  return (
    <div>
      <Space style={{ marginBottom: 16, width: '100%', justifyContent: 'space-between' }}>
        <Space>
          <Title level={3} style={{ color: '#1f2937', margin: 0 }}>
            Audit Logs
          </Title>
          <Tag
            icon={<LockOutlined />}
            color="default"
            style={{ fontSize: 11 }}
          >
            Read Only
          </Tag>
        </Space>
      </Space>

      {/* ── Immutable notice ─────────────────────────────────────────────────── */}
      <Alert
        message="Audit logs are immutable."
        description="All admin actions are permanently recorded. Logs cannot be edited or deleted for compliance and security purposes."
        type="info"
        icon={<InfoCircleOutlined />}
        showIcon
        style={{ marginBottom: 16 }}
      />

      {/* ── Filter bar ───────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Select
            allowClear
            showSearch
            placeholder="All admins"
            style={{ width: 220 }}
            value={adminEmail}
            onChange={(v) => {
              setPage(1)
              setAdminEmail(v)
            }}
            options={adminList}
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
          <Select
            allowClear
            placeholder="All actions"
            style={{ width: 180 }}
            value={actionType}
            onChange={(v) => {
              setPage(1)
              setActionType(v)
            }}
            options={ACTION_OPTIONS}
          />
          <Select
            allowClear
            placeholder="All targets"
            style={{ width: 160 }}
            value={targetType}
            onChange={(v) => {
              setPage(1)
              setTargetType(v)
            }}
            options={TARGET_TYPE_OPTIONS}
          />
          <RangePicker
            style={{ width: 280 }}
            value={dateRange}
            onChange={(dates) => {
              setPage(1)
              setDateRange(dates as [dayjs.Dayjs, dayjs.Dayjs] | null)
            }}
          />
          <Button icon={<ExportOutlined />} onClick={exportCsv}>
            Export CSV
          </Button>
        </Space>
      </Card>

      {/* ── Table ────────────────────────────────────────────────────────────── */}
      <Card>
        <Table<AuditLog>
          loading={loading}
          rowKey="id"
          dataSource={rows}
          columns={columns}
          pagination={{
            current: page,
            pageSize: LIMIT,
            total,
            showSizeChanger: false,
            showTotal: (t) => `${t} log entries`,
            onChange: setPage,
          }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: '8px 16px' }}>
                <DetailsView details={record.details} />
              </div>
            ),
            rowExpandable: () => true,
          }}
          size="middle"
          scroll={{ x: 1000 }}
        />
      </Card>
    </div>
  )
}
