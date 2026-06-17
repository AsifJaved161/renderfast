'use client'

import { useState, useEffect } from 'react'
import { Layout, Avatar, Badge, Button, Tag } from 'antd'
import { BellOutlined, UserOutlined, WarningFilled } from '@ant-design/icons'

const BRAND = '#2da01d'

interface Me {
  full_name: string | null
  email: string
  avatar_url: string | null
}

export default function AdminHeader() {
  const [user, setUser] = useState<Me | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => d.user && setUser(d.user))
      .catch(() => {})
  }, [])

  return (
    <Layout.Header
      style={{
        background: '#141414',
        borderBottom: '1px solid #222',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        height: 64,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        <span style={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>Admin Panel</span>
        <Tag color="error" style={{ margin: 0 }}>
          RESTRICTED
        </Tag>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        {/* Always-on reminder chip */}
        <Tag
          icon={<WarningFilled />}
          style={{
            background: 'rgba(250,173,20,0.12)',
            color: '#faad14',
            border: '1px solid rgba(250,173,20,0.4)',
            margin: 0,
          }}
        >
          Admin Mode
        </Tag>

        <Badge dot>
          <Button type="text" icon={<BellOutlined style={{ color: '#aaa' }} />} aria-label="System alerts" />
        </Badge>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Avatar size={32} src={user?.avatar_url ?? undefined} style={{ background: BRAND }}>
            {user?.full_name?.[0]?.toUpperCase() ?? <UserOutlined />}
          </Avatar>
          <span style={{ color: '#ddd', fontSize: 13 }}>{user?.full_name ?? user?.email ?? '…'}</span>
        </div>
      </div>
    </Layout.Header>
  )
}
