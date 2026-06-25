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
  DollarOutlined,
  CloudServerOutlined,
} from '@ant-design/icons'
import { useClearUserCache } from '@/lib/client-session'

const BRAND = '#2da01d'

const NAV = [
  { key: '/admin/dashboard', icon: <BarChartOutlined />, label: 'Dashboard', hint: 'Platform-wide users, revenue & renders' },
  { key: '/admin/users', icon: <TeamOutlined />, label: 'Users', hint: 'Manage all user accounts' },
  { key: '/admin/plans', icon: <TagsOutlined />, label: 'Plans', hint: 'Pricing tiers & limits' },
  { key: '/admin/subscriptions', icon: <CreditCardOutlined />, label: 'Subscriptions', hint: 'Active Stripe subscriptions' },
  { key: '/admin/renders', icon: <ThunderboltOutlined />, label: 'Renders Monitor', hint: 'Every render across the platform' },
  { key: '/admin/logs', icon: <FileTextOutlined />, label: 'Admin Logs', hint: 'Audit trail of admin actions' },
  { key: '/admin/cloudflare', icon: <CloudServerOutlined />, label: 'Cloudflare Usage', hint: 'Resources used vs remaining + capacity for scale' },
  { key: '/admin/bot-cost', icon: <DollarOutlined />, label: 'Bandwidth Rate', hint: 'Set the $/GB rate for bot cost estimates' },
  { key: '/admin/settings', icon: <SettingOutlined />, label: 'Platform Settings', hint: 'Cloudflare config, usage & queue limits' },
]

export default function AdminSidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const clearUserCache = useClearUserCache()

  const selected = NAV.find((n) => pathname.startsWith(n.key))?.key ?? '/admin/dashboard'

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' })
    clearUserCache()
    router.push('/admin/login')
    router.refresh()
  }

  return (
    <Layout.Sider width={230} style={{ background: '#ffffff', borderRight: '1px solid #e5e7eb' }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '18px 20px', fontWeight: 800, fontSize: 18, color: '#1f2937' }}>
        <ThunderboltFilled style={{ color: BRAND }} />
        Render<span style={{ color: BRAND }}>ForAI</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100% - 60px)' }}>
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[selected]}
          onClick={({ key }) => router.push(key)}
          style={{ background: '#ffffff', border: 'none', flex: 1 }}
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

        <div style={{ padding: 12, borderTop: '1px solid #e5e7eb' }}>
          <Button
            type="text"
            icon={<ExportOutlined />}
            block
            style={{ color: '#6b7280', textAlign: 'left', justifyContent: 'flex-start' }}
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
