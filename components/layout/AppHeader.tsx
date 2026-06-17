'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button, Dropdown, Progress, Avatar, message } from 'antd'
import type { MenuProps } from 'antd'
import { Bell, ChevronDown, HelpCircle, Menu as MenuIcon } from 'lucide-react'
import {
  UserOutlined,
  CreditCardOutlined,
  SettingOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import Logo from './Logo'

interface AppHeaderProps {
  onMenuClick: () => void
}

interface Me {
  full_name: string | null
  email: string
  avatar_url: string | null
  plan: string
  render_count: number
  render_limit: number
}

function initials(name: string | null, email: string) {
  const src = name?.trim() || email
  return src
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join('')
}

export default function AppHeader({ onMenuClick }: AppHeaderProps) {
  const router = useRouter()
  const [user, setUser] = useState<Me | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => d.user && setUser(d.user))
      .catch(() => {})
  }, [])

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    message.success('Logged out')
    router.push('/login')
    router.refresh()
  }

  const usagePercent =
    user && user.render_limit
      ? Math.min(100, Math.round((user.render_count / user.render_limit) * 100))
      : 0

  const menuItems: MenuProps['items'] = [
    { key: 'profile', icon: <UserOutlined />, label: <Link href="/settings">Profile</Link> },
    { key: 'billing', icon: <CreditCardOutlined />, label: <Link href="/billing">Billing</Link> },
    { key: 'settings', icon: <SettingOutlined />, label: <Link href="/settings">Settings</Link> },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Log out', danger: true, onClick: logout },
  ]

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        height: 64,
        background: '#ffffff',
        borderBottom: '1px solid #f0f0f0',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        gap: 8,
      }}
    >
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          type="text"
          icon={<MenuIcon size={18} />}
          onClick={onMenuClick}
          className="lg:hidden"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          aria-label="Toggle sidebar"
        />
        <Link href="/dashboard" aria-label="RenderFast home">
          <Logo />
        </Link>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <Button type="text" icon={<HelpCircle size={16} color="#2da01d" />} style={{ color: '#2da01d', fontWeight: 500, fontSize: 13 }}>
          <span className="hidden sm:inline">Support</span>
        </Button>
        <Button type="text" icon={<Bell size={17} />} style={{ color: '#6b7280' }} aria-label="Notifications" />

        {/* Render usage ring */}
        <div
          className="hidden md:flex"
          style={{ alignItems: 'center', justifyContent: 'center', width: 40 }}
          aria-label={`Render usage: ${usagePercent}%`}
        >
          <Progress
            type="circle"
            percent={usagePercent}
            size={34}
            strokeColor={usagePercent > 80 ? '#ff4d4f' : '#2da01d'}
            trailColor="#e8fae5"
            strokeWidth={9}
            format={() => <span style={{ fontSize: 9, fontWeight: 700, color: '#374151' }}>{usagePercent}%</span>}
          />
        </div>

        <Dropdown menu={{ items: menuItems }} placement="bottomRight" trigger={['click']}>
          <Button type="text" style={{ height: 42, padding: '0 8px', display: 'flex', alignItems: 'center', gap: 8 }} aria-label="User menu">
            <Avatar
              size={30}
              src={user?.avatar_url ?? undefined}
              style={{ background: '#2da01d', fontSize: 12 }}
            >
              {user ? initials(user.full_name, user.email) : <UserOutlined />}
            </Avatar>
            <div className="hidden sm:block" style={{ textAlign: 'left' }}>
              <p style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.25, color: '#111827', margin: 0 }}>
                {user?.full_name ?? user?.email ?? '…'}
              </p>
              <p style={{ fontSize: 11, lineHeight: 1.25, color: '#6b7280', margin: 0, textTransform: 'capitalize' }}>
                {user?.plan ? `${user.plan} plan` : 'Account'}
              </p>
            </div>
            <ChevronDown size={14} color="#9ca3af" />
          </Button>
        </Dropdown>
      </div>
    </header>
  )
}
