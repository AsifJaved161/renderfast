'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Card,
  Table,
  Input,
  Select,
  Button,
  Badge,
  Tag,
  Avatar,
  Progress,
  Dropdown,
  Modal,
  Drawer,
  Form,
  Checkbox,
  Descriptions,
  Typography,
  Space,
  Popconfirm,
  message,
} from 'antd'
import { MoreOutlined, UserOutlined, ExportOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography
const { TextArea } = Input

interface AdminUser {
  id: string
  email: string
  full_name: string | null
  plan: string
  render_count: number
  render_limit: number
  is_banned: boolean
  ban_reason: string | null
  created_at: string
  last_login_at: string | null
  sites_count: number
  stripe_subscription_id: string | null
}

const PLAN_COLOR: Record<string, string> = {
  free: 'default',
  starter: 'blue',
  pro: 'purple',
  agency: 'green',
}

const SORT_MAP: Record<string, { sort: string; order: string }> = {
  newest: { sort: 'created_at', order: 'desc' },
  oldest: { sort: 'created_at', order: 'asc' },
  renders: { sort: 'render_count', order: 'desc' },
  plan: { sort: 'plan', order: 'desc' },
}

function rel(iso: string | null) {
  if (!iso) return 'Never'
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86400_000)
  if (d > 0) return `${d}d ago`
  const h = Math.floor(diff / 3600_000)
  if (h > 0) return `${h}h ago`
  return 'recently'
}

export default function AdminUsersPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<AdminUser[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [plan, setPlan] = useState<string | undefined>()
  const [status, setStatus] = useState('all')
  const [sortKey, setSortKey] = useState('newest')

  const [drawerUser, setDrawerUser] = useState<AdminUser | null>(null)
  const [planModal, setPlanModal] = useState<AdminUser | null>(null)
  const [banModal, setBanModal] = useState<AdminUser | null>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const LIMIT = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { sort, order } = SORT_MAP[sortKey]
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT), status, sort, order })
      if (search) params.set('search', search)
      if (plan) params.set('plan', plan)
      const res = await fetch(`/api/admin/users?${params}`)
      const json = await res.json()
      setRows(json.users ?? [])
      setTotal(json.total ?? 0)
    } catch {
      message.error('Failed to load users')
    } finally {
      setLoading(false)
    }
  }, [page, search, plan, status, sortKey])

  useEffect(() => {
    load()
  }, [load])

  function onSearchChange(v: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setPage(1)
      setSearch(v)
    }, 300)
  }

  async function patchUser(id: string, body: Record<string, unknown>, ok: string) {
    const res = await fetch(`/api/admin/users/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) {
      message.success(ok)
      await load()
      return true
    }
    message.error('Action failed')
    return false
  }

  async function banUser(id: string, ban: boolean, reason?: string) {
    const res = await fetch(`/api/admin/users/${id}/ban`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ban, reason }),
    })
    if (res.ok) {
      message.success(ban ? 'User banned' : 'User unbanned')
      await load()
    } else message.error('Action failed')
  }

  async function impersonate(id: string) {
    const res = await fetch(`/api/admin/users/${id}/impersonate`, { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      message.success('Impersonation token generated')
      window.open(data.redirectUrl ?? '/dashboard', '_blank')
    } else message.error(data.error ?? 'Failed')
  }

  async function deleteUser(id: string) {
    const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' })
    if (res.ok) {
      message.success('Account deleted')
      setDrawerUser(null)
      await load()
    } else message.error('Delete failed')
  }

  function exportCsv() {
    const header = ['Email', 'Name', 'Plan', 'Renders', 'Limit', 'Sites', 'Status', 'Joined']
    const lines = rows.map((u) =>
      [u.email, u.full_name ?? '', u.plan, u.render_count, u.render_limit, u.sites_count, u.is_banned ? 'Banned' : 'Active', u.created_at]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `users-${Date.now()}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function rowMenu(u: AdminUser) {
    return {
      items: [
        { key: 'view', label: 'View Profile' },
        { key: 'plan', label: 'Change Plan' },
        u.is_banned ? { key: 'unban', label: 'Unban User' } : { key: 'ban', label: 'Ban User', danger: true },
        { key: 'reset', label: 'Reset Render Count' },
        { key: 'impersonate', label: 'Impersonate User' },
        { type: 'divider' as const },
        { key: 'delete', label: 'Delete Account', danger: true },
      ],
      onClick: ({ key }: { key: string }) => {
        if (key === 'view') setDrawerUser(u)
        else if (key === 'plan') setPlanModal(u)
        else if (key === 'ban') setBanModal(u)
        else if (key === 'unban') banUser(u.id, false)
        else if (key === 'reset') patchUser(u.id, { render_count: 0 }, 'Render count reset')
        else if (key === 'impersonate') impersonate(u.id)
        else if (key === 'delete') {
          Modal.confirm({
            title: 'Delete this account?',
            content: `${u.email} — this is permanent.`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: () => deleteUser(u.id),
          })
        }
      },
    }
  }

  return (
    <div>
      <Space style={{ marginBottom: 16 }}>
        <Title level={3} style={{ color: '#1f2937', margin: 0 }}>
          Users
        </Title>
        <Badge count={total} overflowCount={99999} style={{ backgroundColor: BRAND }} />
      </Space>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <Card style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input.Search placeholder="Search email or name" allowClear onChange={(e) => onSearchChange(e.target.value)} style={{ width: 240 }} />
          <Select
            allowClear
            placeholder="All plans"
            style={{ width: 140 }}
            value={plan}
            onChange={(v) => {
              setPage(1)
              setPlan(v)
            }}
            options={[
              { value: 'free', label: 'Free' },
              { value: 'starter', label: 'Starter' },
              { value: 'pro', label: 'Pro' },
              { value: 'agency', label: 'Agency' },
            ]}
          />
          <Select
            style={{ width: 130 }}
            value={status}
            onChange={(v) => {
              setPage(1)
              setStatus(v)
            }}
            options={[
              { value: 'all', label: 'All status' },
              { value: 'active', label: 'Active' },
              { value: 'banned', label: 'Banned' },
            ]}
          />
          <Select
            style={{ width: 160 }}
            value={sortKey}
            onChange={setSortKey}
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'oldest', label: 'Oldest' },
              { value: 'renders', label: 'Most Renders' },
              { value: 'plan', label: 'Highest Plan' },
            ]}
          />
          <Button icon={<ExportOutlined />} onClick={exportCsv}>
            Export CSV
          </Button>
        </Space>
      </Card>

      {/* ── Table ───────────────────────────────────────────────────────────── */}
      <Card>
        <Table<AdminUser>
          loading={loading}
          rowKey="id"
          dataSource={rows}
          onRow={(u) => ({ onClick: () => setDrawerUser(u), style: { cursor: 'pointer' } })}
          pagination={{ current: page, pageSize: LIMIT, total, showSizeChanger: false, onChange: setPage }}
          columns={[
            {
              title: 'User',
              render: (_, u) => (
                <Space>
                  <Avatar style={{ background: BRAND }}>
                    {u.full_name?.[0]?.toUpperCase() ?? <UserOutlined />}
                  </Avatar>
                  <div>
                    <div style={{ color: '#eee' }}>{u.full_name ?? '—'}</div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {u.email}
                    </Text>
                  </div>
                </Space>
              ),
            },
            {
              title: 'Plan',
              dataIndex: 'plan',
              width: 100,
              render: (p: string) => <Tag color={PLAN_COLOR[p]}>{p}</Tag>,
            },
            {
              title: 'Renders',
              width: 160,
              render: (_, u) => (
                <div>
                  <Text style={{ fontSize: 12, color: '#6b7280' }}>
                    {u.render_count.toLocaleString()} / {u.render_limit.toLocaleString()}
                  </Text>
                  <Progress
                    percent={u.render_limit ? Math.min(100, Math.round((u.render_count / u.render_limit) * 100)) : 0}
                    showInfo={false}
                    size="small"
                    strokeColor={BRAND}
                  />
                </div>
              ),
            },
            { title: 'Sites', dataIndex: 'sites_count', width: 70 },
            {
              title: 'Status',
              width: 100,
              render: (_, u) => (u.is_banned ? <Tag color="red">Banned</Tag> : <Tag color="green">Active</Tag>),
            },
            { title: 'Joined', width: 110, render: (_, u) => rel(u.created_at) },
            { title: 'Last Login', width: 110, render: (_, u) => rel(u.last_login_at) },
            {
              title: '',
              width: 50,
              render: (_, u) => (
                <Dropdown menu={rowMenu(u)} trigger={['click']}>
                  <Button type="text" icon={<MoreOutlined />} onClick={(e) => e.stopPropagation()} />
                </Dropdown>
              ),
            },
          ]}
        />
      </Card>

      {/* ── Detail drawer ───────────────────────────────────────────────────── */}
      <UserDrawer
        user={drawerUser}
        onClose={() => setDrawerUser(null)}
        onChangePlan={(u) => setPlanModal(u)}
        onBan={(u) => setBanModal(u)}
        onUnban={(u) => banUser(u.id, false)}
        onDelete={deleteUser}
        onSaveNotes={(u, notes) => patchUser(u.id, { notes }, 'Notes saved')}
      />

      {/* ── Change plan modal ───────────────────────────────────────────────── */}
      <ChangePlanModal
        user={planModal}
        onClose={() => setPlanModal(null)}
        onConfirm={async (u, newPlan) => {
          const okFlag = await patchUser(u.id, { plan: newPlan }, 'Plan updated')
          if (okFlag) setPlanModal(null)
        }}
      />

      {/* ── Ban modal ───────────────────────────────────────────────────────── */}
      <BanModal
        user={banModal}
        onClose={() => setBanModal(null)}
        onConfirm={async (u, reason) => {
          await banUser(u.id, true, reason)
          setBanModal(null)
        }}
      />
    </div>
  )
}

// ── User detail drawer ──────────────────────────────────────────────────────
function UserDrawer({
  user,
  onClose,
  onChangePlan,
  onBan,
  onUnban,
  onDelete,
  onSaveNotes,
}: {
  user: AdminUser | null
  onClose: () => void
  onChangePlan: (u: AdminUser) => void
  onBan: (u: AdminUser) => void
  onUnban: (u: AdminUser) => void
  onDelete: (id: string) => void
  onSaveNotes: (u: AdminUser, notes: string) => void
}) {
  const [detail, setDetail] = useState<any>(null)
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!user) return
    setDetail(null)
    fetch(`/api/admin/users/${user.id}`)
      .then((r) => r.json())
      .then((d) => {
        setDetail(d)
        setNotes(d.user?.notes ?? '')
      })
      .catch(() => {})
  }, [user])

  if (!user) return null
  const u = detail?.user ?? user
  const apiKeyMasked = u.api_key ? `${u.api_key.slice(0, 6)}••••••••` : '—'

  return (
    <Drawer open width={600} onClose={onClose} title={u.email}>
      <Descriptions column={1} size="small" bordered>
        <Descriptions.Item label="Name">{u.full_name ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Company">{u.company_name ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Plan">
          <Tag color={PLAN_COLOR[u.plan]}>{u.plan}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="API Key">{apiKeyMasked}</Descriptions.Item>
        <Descriptions.Item label="Created">{new Date(u.created_at).toLocaleString()}</Descriptions.Item>
      </Descriptions>

      <div style={{ margin: '16px 0' }}>
        <Text type="secondary">
          Renders: {u.render_count?.toLocaleString()} / {u.render_limit?.toLocaleString()}
        </Text>
        <Progress
          percent={u.render_limit ? Math.min(100, Math.round((u.render_count / u.render_limit) * 100)) : 0}
          strokeColor={BRAND}
        />
      </div>

      <Title level={5}>Sites</Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={detail?.sites ?? []}
        columns={[
          { title: 'Domain', dataIndex: 'domain' },
          { title: 'Status', dataIndex: 'status', width: 90 },
        ]}
      />

      <Title level={5} style={{ marginTop: 16 }}>
        Recent Renders
      </Title>
      <Table
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={detail?.renders ?? []}
        columns={[
          { title: 'URL', dataIndex: 'url', ellipsis: true },
          { title: 'Code', dataIndex: 'status_code', width: 70 },
        ]}
      />

      <Title level={5} style={{ marginTop: 16 }}>
        Admin Notes
      </Title>
      <TextArea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      <Button size="small" style={{ marginTop: 8 }} onClick={() => onSaveNotes(u, notes)}>
        Save Notes
      </Button>

      <Space style={{ marginTop: 24, width: '100%', justifyContent: 'space-between' }}>
        {u.is_banned ? (
          <Button onClick={() => onUnban(u)}>Unban</Button>
        ) : (
          <Button danger onClick={() => onBan(u)}>
            Ban
          </Button>
        )}
        <Button onClick={() => onChangePlan(u)}>Change Plan</Button>
        <Popconfirm title="Delete this account?" onConfirm={() => onDelete(u.id)} okButtonProps={{ danger: true }}>
          <Button danger type="primary">
            Delete
          </Button>
        </Popconfirm>
      </Space>
    </Drawer>
  )
}

// ── Change plan modal ───────────────────────────────────────────────────────
function ChangePlanModal({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUser | null
  onClose: () => void
  onConfirm: (u: AdminUser, plan: string) => void
}) {
  const [newPlan, setNewPlan] = useState<string>('free')
  const [matchLimit, setMatchLimit] = useState(true)

  useEffect(() => {
    if (user) setNewPlan(user.plan)
  }, [user])

  if (!user) return null
  return (
    <Modal open title="Change Plan" onCancel={onClose} onOk={() => onConfirm(user, newPlan)} okText="Confirm">
      <Form layout="vertical">
        <Form.Item label="New plan">
          <Select
            value={newPlan}
            onChange={setNewPlan}
            options={['free', 'starter', 'pro', 'agency'].map((p) => ({ value: p, label: p }))}
          />
        </Form.Item>
        <Checkbox checked={matchLimit} onChange={(e) => setMatchLimit(e.target.checked)}>
          Also update render_limit to match plan default
        </Checkbox>
      </Form>
    </Modal>
  )
}

// ── Ban modal ───────────────────────────────────────────────────────────────
function BanModal({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUser | null
  onClose: () => void
  onConfirm: (u: AdminUser, reason: string) => void
}) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (user) setReason('')
  }, [user])

  if (!user) return null
  return (
    <Modal
      open
      title={`Ban ${user.email}`}
      onCancel={onClose}
      okText="Ban User"
      okButtonProps={{ danger: true, disabled: !reason.trim() }}
      onOk={() => onConfirm(user, reason)}
    >
      <Text type="warning">⚠️ This will immediately revoke the user&apos;s session.</Text>
      <TextArea
        rows={3}
        style={{ marginTop: 12 }}
        placeholder="Reason for ban (required)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
    </Modal>
  )
}
