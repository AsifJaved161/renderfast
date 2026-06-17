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
import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  href: string
  icon: LucideIcon
  badge?: string
}

export interface NavGroup {
  groupLabel?: string
  items: NavItem[]
}

export const navGroups: NavGroup[] = [
  {
    items: [
      { label: 'Get Started', href: '/integration-wizard', icon: Zap },
      { label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, badge: 'Beta' },
      { label: 'CDN Analytics', href: '/cdn-analytics', icon: Globe, badge: 'Beta' },
      { label: 'Deep Insight', href: '/insight', icon: PieChart },
      { label: 'Cache Manager', href: '/cache', icon: Cloud },
      { label: 'Domain Manager', href: '/domain-manager', icon: Monitor },
      { label: 'Sitemaps', href: '/sitemaps', icon: RefreshCw },
      { label: 'Caching Queue', href: '/caching-queue', icon: Clock },
      { label: 'Render History', href: '/render-history', icon: TrendingUp },
      { label: '404 Checker', href: '/404-checker', icon: CheckSquare },
      { label: 'Google Search Console', href: '/gsc', icon: Search },
    ],
  },
  {
    groupLabel: 'Settings',
    items: [
      { label: 'Billing', href: '/billing', icon: CreditCard },
      { label: 'Security & Access', href: '/security', icon: Lock },
      { label: 'Advanced Settings', href: '/settings', icon: Settings },
    ],
  },
]
