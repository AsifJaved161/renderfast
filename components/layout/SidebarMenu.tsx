'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Menu, Tag, Button } from 'antd'
import type { MenuProps } from 'antd'
import {
  Zap,
  LayoutDashboard,
  Globe,
  PieChart,
  Cloud,
  Monitor,
  RefreshCw,
  Clock,
  TrendingUp,
  CheckSquare,
  Search,
  CreditCard,
  Lock,
  Settings,
} from 'lucide-react'

type MenuItem = Required<MenuProps>['items'][number]

const betaTag = (
  <Tag
    bordered={false}
    color="purple"
    style={{ fontSize: 10, padding: '0 5px', lineHeight: '18px', marginInlineStart: 6 }}
  >
    Beta
  </Tag>
)

const menuItems: MenuProps['items'] = [
  {
    key: '/integration-wizard',
    icon: <Zap size={15} />,
    label: 'Get Started',
  },
  {
    key: '/dashboard',
    icon: <LayoutDashboard size={15} />,
    label: <span className="flex items-center">Dashboard{betaTag}</span>,
  },
  {
    key: '/cdn-analytics',
    icon: <Globe size={15} />,
    label: <span className="flex items-center">CDN Analytics{betaTag}</span>,
  },
  {
    key: '/insight',
    icon: <PieChart size={15} />,
    label: 'Deep Insight',
  },
  {
    key: '/cache',
    icon: <Cloud size={15} />,
    label: 'Cache Manager',
  },
  {
    key: '/domain-manager',
    icon: <Monitor size={15} />,
    label: 'Domain Manager',
  },
  {
    key: '/sitemaps',
    icon: <RefreshCw size={15} />,
    label: 'Sitemaps',
  },
  {
    key: '/caching-queue',
    icon: <Clock size={15} />,
    label: 'Caching Queue',
  },
  {
    key: '/render-history',
    icon: <TrendingUp size={15} />,
    label: 'Render History',
  },
  {
    key: '/404-checker',
    icon: <CheckSquare size={15} />,
    label: '404 Checker',
  },
  {
    key: '/gsc',
    icon: <Search size={15} />,
    label: 'Google Search Console',
  },
  { type: 'divider' },
  {
    type: 'group',
    label: 'Settings',
    children: [
      { key: '/billing', icon: <CreditCard size={15} />, label: 'Billing' },
      { key: '/security', icon: <Lock size={15} />, label: 'Security & Access' },
      { key: '/settings', icon: <Settings size={15} />, label: 'Advanced Settings' },
    ],
  },
] satisfies MenuItem[]

const allKeys = menuItems.flatMap((item: any) =>
  item?.children ? item.children.map((c: any) => c?.key as string) : item?.key ? [item.key as string] : []
)

interface SidebarMenuProps {
  onNavigate?: () => void
}

export default function SidebarMenu({ onNavigate }: SidebarMenuProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [plan, setPlan] = useState<string>('free')

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => d.user?.plan && setPlan(d.user.plan))
      .catch(() => {})
  }, [])

  const selectedKey =
    allKeys.find((key) => pathname === key || pathname.startsWith(key + '/')) ?? ''

  const isFree = plan === 'free'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Nav */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        <Menu
          mode="inline"
          selectedKeys={selectedKey ? [selectedKey] : []}
          items={menuItems}
          style={{ border: 'none', background: 'transparent' }}
          onClick={({ key }) => {
            router.push(key)
            onNavigate?.()
          }}
        />
      </div>

      {/* Plan banner */}
      <div style={{ padding: '12px 12px 16px' }}>
        <div
          style={{
            background: '#e8fae5',
            border: '1px solid #ccf5c7',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <Zap size={13} color="#2da01d" />
            <span style={{ fontSize: 12, fontWeight: 600, color: '#2da01d', textTransform: 'capitalize' }}>
              {plan} plan
            </span>
          </div>
          <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 10px' }}>
            {isFree ? 'Upgrade to unlock more renders & sites' : 'Thanks for being a subscriber!'}
          </p>
          {isFree && (
            <Button type="primary" size="small" block onClick={() => router.push('/billing')}>
              Upgrade Now
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
