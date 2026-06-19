'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Layout, Menu, Button, Tooltip } from 'antd'
import {
  BarChartOutlined,
  TeamOutlined,
  TagsOutlined,
  CreditCardOutlined,
  ThunderboltOutlined,
  FileTextOutlined,
  ExportOutlined,
  LogoutOutlined,
  ThunderboltFilled,
  SettingOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'

const NAV = [
  { key: '/admin/dashboard', icon: <BarChartOutlined />, label: 'Dashboard', hint: 'Platform-wide users, revenue & renders' },
  { key: '/admin/users', icon: <TeamOutlined />, label: 'Users', hint: 'Manage all user accounts' },
  { key: '/admin/plans', icon: <TagsOutlined />, label: 'Plans', hint: 'Pricing tiers & limits' },
  { key: '/admin/subscriptions', icon: <CreditCardOutlined />, label: 'Subscriptions', hint: 'Active Stripe subscriptions' },
  { key: '/admin/renders', icon: <ThunderboltOutlined />, label: 'Renders Monitor', hint: 'Every render across the platform' },
  { key: '/admin/logs', icon: <FileTextOutlined />, label: 'Admin Logs', hint: 'Audit trail of admin actions' },
  { key: '/admin/settings', icon: <SettingOutlined />, label: 'Platform Settings', hint: 'Cloudflare config, usage & queue limits' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()

  const selected = NAV.find((n) => pathname.startsWith(n.key))?.key ?? '/admin/dashboard'

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <Layout.Sider width={230} style={{ background: '#141414', borderRight: '1px solid #222' }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 20px', fontWeight: 800, fontSize: 18, color: '#fff' }}>
        <ThunderboltFilled style={{ color: BRAND }} />
        Render<span style={{ color: BRAND }}>Fast</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 60px)' }}>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected]}
          onClick={({ key }) => router.push(key)}
          style={{ background: '#141414', border: 'none', flex: 1 }}
          items={NAV.map((n) => ({
            key: n.key,
            icon: n.icon,
            label: (
              <Tooltip title={n.hint} placement="right" mouseEnterDelay={0.3}>
                <span>{n.label}</span>
              </Tooltip>
            ),
          }))}
        />

        <div style={{ padding: 12, borderTop: '1px solid #222' }}>
          <Button
            type="text"
            icon={<ExportOutlined />}
            block
            style={{ color: '#aaa', textAlign: 'left', justifyContent: 'flex-start' }}
            onClick={() => window.open('/dashboard', '_blank')}
          >
            View Client App
          </Button>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            block
            danger
            style={{ textAlign: 'left', justifyContent: 'flex-start', marginTop: 4 }}
            onClick={logout}
          >
            Logout
          </Button>
        </div>
      </div>
    </Layout.Sider>
  )
}
