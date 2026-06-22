'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  Table,
  Input,
  Select,
  Button,
  Tag,
  Typography,
  Space,
  Popconfirm,
  Alert,
  Skeleton,
  message,
} from 'antd'
import { TeamOutlined, UserAddOutlined, SwapOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography

const ROLE_COLOR: Record<string, string> = { owner: 'green', admin: 'blue', member: 'default', viewer: 'gold' }
const ROLE_OPTS = [
  { value: 'admin', label: 'Admin — manage team + use everything' },
  { value: 'member', label: 'Member — use everything (no team/billing)' },
  { value: 'viewer', label: 'Viewer — read-only' },
]

interface Member {
  id: string
  email: string
  name: string | null
  role: string
  status: string
  isYou: boolean
}
interface Account {
  id: string
  name: string
  role: string
  isCurrent: boolean
}
interface Invite {
  token: string | null
  ownerName: string
  role: string
}
interface TeamData {
  accountId: string
  selfId: string
  role: string
  isOwnAccount: boolean
  members: Member[]
  accounts: Account[]
  invitesForMe: Invite[]
}

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null)
  const [loading, setLoading] = useState(true)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('member')
  const [inviting, setInviting] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/team')
      setData(res.ok ? await res.json() : null)
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Auto-accept an invite arriving from the email link (?invite=token).
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite')
    if (!token) {
      load()
      return
    }
    ;(async () => {
      try {
        const res = await fetch('/api/team/accept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        })
        if (res.ok) message.success('Invitation accepted')
        else message.warning((await res.json().catch(() => ({})))?.error ?? 'Could not accept invite')
      } catch {
        /* ignore */
      } finally {
        window.history.replaceState({}, '', '/team')
        load()
      }
    })()
  }, [load])

  async function invite() {
    if (!inviteEmail.trim()) {
      message.error('Enter an email')
      return
    }
    setInviting(true)
    try {
      const res = await fetch('/api/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      })
      if (res.ok) {
        message.success('Invitation sent')
        setInviteEmail('')
        load()
      } else {
        message.error((await res.json().catch(() => ({})))?.error ?? 'Invite failed')
      }
    } finally {
      setInviting(false)
    }
  }

  async function changeRole(id: string, role: string) {
    const res = await fetch(`/api/team/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    if (res.ok) {
      message.success('Role updated')
      load()
    } else message.error('Update failed')
  }

  async function remove(id: string) {
    const res = await fetch(`/api/team/${id}`, { method: 'DELETE' })
    if (res.ok) {
      message.success('Member removed')
      load()
    } else message.error('Remove failed')
  }

  async function switchTo(accountId: string) {
    const res = await fetch('/api/team/switch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    })
    if (res.ok) window.location.reload()
    else message.error('Switch failed')
  }

  async function acceptInvite(token: string | null) {
    if (!token) return
    const res = await fetch('/api/team/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    if (res.ok) {
      message.success('Invitation accepted')
      load()
    } else message.error((await res.json().catch(() => ({})))?.error ?? 'Accept failed')
  }

  if (loading) return <div style={{ padding: 24 }}><Skeleton active paragraph={{ rows: 8 }} /></div>
  if (!data) return <div style={{ padding: 24 }}><Card>Failed to load team.</Card></div>

  const canManage = data.role === 'owner' || data.role === 'admin'

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <Title level={3} style={{ marginTop: 0 }}>
        <Space><TeamOutlined style={{ color: BRAND }} /> Team</Space>
      </Title>
      <Paragraph type="secondary">
        Invite team members to share access to this account. Members work within this account&apos;s
        plan and render quota. {data.isOwnAccount ? '' : 'You are currently working in a shared account.'}
      </Paragraph>

      {/* Pending invites addressed to me */}
      {data.invitesForMe.length > 0 && (
        <Card style={{ marginBottom: 16 }} title="Invitations for you">
          {data.invitesForMe.map((inv, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
              <Text>
                <strong>{inv.ownerName}</strong> invited you as <Tag color={ROLE_COLOR[inv.role]}>{inv.role}</Tag>
              </Text>
              <Button type="primary" size="small" style={{ background: BRAND, borderColor: BRAND }} onClick={() => acceptInvite(inv.token)}>
                Accept
              </Button>
            </div>
          ))}
        </Card>
      )}

      {/* Account switcher (if the user belongs to more than one account) */}
      {data.accounts.length > 1 && (
        <Card style={{ marginBottom: 16 }} title={<Space><SwapOutlined /> Switch account</Space>}>
          <Space wrap>
            {data.accounts.map((a) => (
              <Button
                key={a.id}
                type={a.isCurrent ? 'primary' : 'default'}
                style={a.isCurrent ? { background: BRAND, borderColor: BRAND } : {}}
                onClick={() => !a.isCurrent && switchTo(a.id)}
              >
                {a.name} <Tag color={ROLE_COLOR[a.role]} style={{ marginLeft: 6 }}>{a.role}</Tag>
              </Button>
            ))}
          </Space>
        </Card>
      )}

      {/* Invite form (owner/admin only) */}
      {canManage && (
        <Card style={{ marginBottom: 16 }} title={<Space><UserAddOutlined /> Invite a member</Space>}>
          <Space wrap>
            <Input
              placeholder="teammate@email.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              style={{ width: 260 }}
              onPressEnter={invite}
            />
            <Select value={inviteRole} onChange={setInviteRole} options={ROLE_OPTS} style={{ width: 320 }} />
            <Button type="primary" loading={inviting} onClick={invite} style={{ background: BRAND, borderColor: BRAND }}>
              Send invite
            </Button>
          </Space>
        </Card>
      )}

      {/* Members */}
      <Card title="Members">
        <Table<Member>
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={data.members}
          locale={{ emptyText: 'No team members yet — invite someone above.' }}
          columns={[
            {
              title: 'Member',
              render: (_, m) => (
                <span>
                  {m.name ? `${m.name} · ` : ''}{m.email} {m.isYou && <Tag>you</Tag>}
                </span>
              ),
            },
            {
              title: 'Role',
              width: 320,
              render: (_, m) =>
                canManage && !m.isYou ? (
                  <Select size="small" value={m.role} options={ROLE_OPTS} style={{ width: 300 }} onChange={(v) => changeRole(m.id, v)} />
                ) : (
                  <Tag color={ROLE_COLOR[m.role]}>{m.role}</Tag>
                ),
            },
            {
              title: 'Status',
              width: 100,
              render: (_, m) => (m.status === 'active' ? <Tag color="green">active</Tag> : <Tag color="orange">pending</Tag>),
            },
            {
              title: '',
              width: 90,
              render: (_, m) =>
                canManage && !m.isYou ? (
                  <Popconfirm title="Remove this member?" onConfirm={() => remove(m.id)} okButtonProps={{ danger: true }}>
                    <Button size="small" danger>Remove</Button>
                  </Popconfirm>
                ) : null,
            },
          ]}
        />
      </Card>

      {!canManage && (
        <Alert style={{ marginTop: 16 }} type="info" showIcon message="You have limited access to this account's team settings." />
      )}
    </div>
  )
}
