'use client'

import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ConfigProvider,
  Layout,
  Menu,
  theme,
  Select,
  Progress,
  Avatar,
  Dropdown,
  Tag,
  Button,
  Tooltip,
  Badge,
  Popover,
  List,
  Empty,
  Alert,
} from 'antd'
import type { MenuProps } from 'antd'
import {
  HomeOutlined,
  CompassOutlined,
  BarChartOutlined,
  BulbOutlined,
  BulbFilled,
  HistoryOutlined,
  EyeOutlined,
  DatabaseOutlined,
  ThunderboltOutlined,
  ApartmentOutlined,
  GlobalOutlined,
  WarningOutlined,
  LineChartOutlined,
  DollarOutlined,
  FileTextOutlined,
  FileSearchOutlined,
  CloseCircleOutlined,
  CreditCardOutlined,
  LockOutlined,
  SettingOutlined,
  TeamOutlined,
  RocketOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  BellOutlined,
} from '@ant-design/icons'
import { DashboardContext } from '@/lib/dashboard-context'
import AppProviders from '@/components/providers/AppProviders'
import { useClearUserCache } from '@/lib/client-session'
import { AccountSwitcher } from '@/components/dashboard/AccountSwitcher'
import { PLAN_LIMITS } from '@/lib/constants'
import type { DbUser, DbSite, Plan } from '@/lib/supabase'

const { Sider, Header, Content } = Layout

const BRAND = '#2da01d'
const HEADER_HEIGHT = 56
const SIDEBAR_KEY = 'rf:selectedSiteId'
const THEME_KEY = 'rf:theme'

type ThemeMode = 'light' | 'dark'

// Palette per mode. Light is the default (matches the original light UI);
// dark mirrors the previous hardcoded look.
function palette(mode: ThemeMode) {
  return mode === 'dark'
    ? {
        appBg: '#0f0f0f',
        siderBg: '#141414',
        contentBg: '#111111',
        headerBg: '#1a1a1a',
        border: '#2a2a2a',
        title: '#ffffff',
        sub: '#888888',
        logoRender: '#ffffff',
        trail: '#2a2a2a',
      }
    : {
        appBg: '#f5f6f8',
        siderBg: '#ffffff',
        contentBg: '#f9fafb',
        headerBg: '#ffffff',
        border: '#e5e7eb',
        title: '#1f2937',
        sub: '#6b7280',
        logoRender: '#1a1a2e',
        trail: '#f0f0f0',
      }
}

// ── Navigation config (drives the Menu + page-title lookup) ───────────────────
interface NavItem {
  key: string // route path
  label: string
  icon: React.ReactNode
  hint: string // 1-line tooltip shown on hover
}
interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV: NavGroup[] = [
  {
    title: 'ANALYTICS',
    items: [
      { key: '/onboarding', label: 'Get Started', icon: <CompassOutlined />, hint: 'Guided setup — add a site & see your first render' },
      { key: '/domain-manager', label: 'Domain Manager', icon: <GlobalOutlined />, hint: 'Add & manage your websites' },
      { key: '/dashboard', label: 'Dashboard', icon: <HomeOutlined />, hint: 'Overview of bot traffic & cache performance' },
      { key: '/cdn-analytics', label: 'CDN Analytics', icon: <BarChartOutlined />, hint: 'Detailed crawler traffic & cache stats' },
      { key: '/insight', label: 'SEO Insights', icon: <BulbOutlined />, hint: 'Search Console clicks, impressions & position' },
      { key: '/bot-visibility', label: 'Bot Visibility', icon: <EyeOutlined />, hint: 'What AI crawlers actually see on your pages' },
      { key: '/bot-cost', label: 'Bot Cost Insights', icon: <DollarOutlined />, hint: 'Estimated bandwidth cost of bot traffic, per crawler' },
      { key: '/render-history', label: 'Render History', icon: <HistoryOutlined />, hint: 'Log of every page rendered for bots' },
    ],
  },
  {
    title: 'CACHE',
    items: [
      { key: '/cache', label: 'Cache Manager', icon: <DatabaseOutlined />, hint: 'View & clear your cached pages' },
      { key: '/caching-queue', label: 'Caching Queue', icon: <ThunderboltOutlined />, hint: 'Pages waiting to be pre-rendered' },
      { key: '/sitemaps', label: 'Sitemaps', icon: <ApartmentOutlined />, hint: 'URLs discovered from your sitemap' },
    ],
  },
  {
    title: 'SITE HEALTH',
    items: [
      { key: '/seo-reports', label: 'SEO Reports', icon: <FileSearchOutlined />, hint: 'Duplicate titles/content, thin pages, hreflang & a page explorer' },
      { key: '/404-checker', label: '404 Checker', icon: <WarningOutlined />, hint: 'Find broken links on your site' },
      { key: '/render-errors', label: 'Render Errors', icon: <CloseCircleOutlined />, hint: 'Pages whose render failed, grouped by reason — retry them' },
      { key: '/llms-txt', label: 'llms.txt', icon: <FileTextOutlined />, hint: 'Auto-generated llms.txt so AI systems understand your site' },
      { key: '/gsc', label: 'GSC', icon: <LineChartOutlined />, hint: 'Connect Google Search Console' },
    ],
  },
  {
    title: 'ACCOUNT',
    items: [
      { key: '/billing', label: 'Billing', icon: <CreditCardOutlined />, hint: 'Your plan & payment details' },
      { key: '/team', label: 'Team', icon: <TeamOutlined />, hint: 'Invite & manage team members' },
      { key: '/security', label: 'Security', icon: <LockOutlined />, hint: 'API keys & access settings' },
      { key: '/settings', label: 'Settings', icon: <SettingOutlined />, hint: 'Account preferences' },
      { key: '/integration-wizard', label: 'Integration Guide', icon: <RocketOutlined />, hint: 'Connect RenderForAI to your site' },
    ],
  },
]

// Flat label lookup for the header page title.
const TITLE_BY_PATH: Record<string, string> = Object.fromEntries(
  NAV.flatMap((g) => g.items.map((i) => [i.key, i.label]))
)

// Pick the best-matching nav key for the current pathname (longest prefix wins,
// so /dashboard/cache/123 still highlights "Cache Manager").
function activeKey(pathname: string): string {
  const keys = NAV.flatMap((g) => g.items.map((i) => i.key))
  const exact = keys.find((k) => k === pathname)
  if (exact) return exact
  const prefix = keys
    .filter((k) => k !== '/dashboard' && pathname.startsWith(k))
    .sort((a, b) => b.length - a.length)[0]
  return prefix ?? '/dashboard'
}

function pageTitle(pathname: string): string {
  return TITLE_BY_PATH[activeKey(pathname)] ?? 'Dashboard'
}

const PLAN_COLOR: Record<Plan, string> = {
  free: 'default',
  starter: 'blue',
  pro: 'green',
  agency: 'gold',
}

function initials(user: DbUser | null): string {
  const src = user?.full_name || user?.email || '?'
  const parts = src.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export default function DashboardRootLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname() || '/dashboard'
  const clearUserCache = useClearUserCache()

  const [collapsed, setCollapsed] = useState(false)
  const [mode, setMode] = useState<ThemeMode>('light')
  const [user, setUser] = useState<DbUser | null>(null)
  const [sites, setSites] = useState<DbSite[]>([])
  const [selectedSiteId, setSelectedSiteIdState] = useState<string | null>(null)

  // ── Notifications (localStorage-based, no backend) ──────────────────────────
  const NOTIF_KEY = 'rf:notifications'
  interface AppNotif { id: string; text: string; time: string; read: boolean }
  const [notifs, setNotifs] = useState<AppNotif[]>([])
  const [bellOpen, setBellOpen] = useState(false)

  // Load from localStorage once on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(NOTIF_KEY)
      if (raw) setNotifs(JSON.parse(raw))
    } catch { /* ignore */ }
  }, [])

  // Listen for notifications pushed from other parts of the app (same tab)
  useEffect(() => {
    function onNotifUpdate() {
      try {
        const raw = localStorage.getItem(NOTIF_KEY)
        if (raw) setNotifs(JSON.parse(raw))
      } catch { /* ignore */ }
    }
    window.addEventListener('rf-notif-update', onNotifUpdate)
    return () => window.removeEventListener('rf-notif-update', onNotifUpdate)
  }, [NOTIF_KEY])


  // Persist whenever notifs change
  useEffect(() => {
    try {
      localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs))
    } catch { /* ignore */ }
  }, [notifs])

  const unreadCount = notifs.filter((n) => !n.read).length

  function markAllRead() {
    setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))
  }

  // ── WordPress plugin reminder ───────────────────────────────────────────────
  // Shows a banner if user marked a site as WordPress but hasn't connected the
  // plugin yet. Dismissed permanently via localStorage.
  const WP_KEY = 'rf:wordpress-sites'
  const WP_DISMISS_KEY = 'rf:wp-reminder-dismissed'
  const [showWpReminder, setShowWpReminder] = useState(false)

  useEffect(() => {
    try {
      // If user already dismissed, never show again
      if (localStorage.getItem(WP_DISMISS_KEY) === '1') return

      const wpSiteIds: string[] = JSON.parse(localStorage.getItem(WP_KEY) || '[]')
      if (wpSiteIds.length === 0) return

      // Check if any of those WordPress sites still lack the plugin connection
      const hasUnconnected = sites.some(
        (s) => wpSiteIds.includes(s.id) && s.integration_type !== 'wordpress'
      )
      setShowWpReminder(hasUnconnected)
    } catch { /* ignore */ }
  }, [sites])

  function dismissWpReminder() {
    setShowWpReminder(false)
    try { localStorage.setItem(WP_DISMISS_KEY, '1') } catch { /* ignore */ }
  }

  // Persist site selection to localStorage.
  const setSelectedSiteId = useCallback((id: string | null) => {
    setSelectedSiteIdState(id)
    try {
      if (id) localStorage.setItem(SIDEBAR_KEY, id)
      else localStorage.removeItem(SIDEBAR_KEY)
    } catch {
      /* ignore storage failures (private mode, etc.) */
    }
  }, [])

  // Load persisted theme (default light). Read in an effect to avoid SSR mismatch.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY)
      if (stored === 'dark' || stored === 'light') setMode(stored)
    } catch {
      /* ignore */
    }
  }, [])

  // Warm the router cache for every sidebar route so clicking opens instantly
  // (the sidebar navigates with router.push, which otherwise doesn't prefetch).
  useEffect(() => {
    for (const group of NAV) for (const item of group.items) router.prefetch(item.key)
  }, [router])

  const toggleTheme = useCallback(() => {
    setMode((m) => {
      const next: ThemeMode = m === 'dark' ? 'light' : 'dark'
      try {
        localStorage.setItem(THEME_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  // Fetch the current user.
  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (!cancelled) setUser(d.user ?? null)
      })
      .catch(() => {
        if (!cancelled) router.push('/login')
      })
    return () => {
      cancelled = true
    }
  }, [router])

  // Fetch sites, then restore the stored selection (or default to the first site).
  useEffect(() => {
    let cancelled = false
    fetch('/api/sites')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (cancelled) return
        const list: DbSite[] = d.sites ?? []
        setSites(list)
        let stored: string | null = null
        try {
          stored = localStorage.getItem(SIDEBAR_KEY)
        } catch {
          stored = null
        }
        const valid = stored && list.some((s) => s.id === stored) ? stored : list[0]?.id ?? null
        setSelectedSiteIdState(valid)
      })
      .catch(() => {
        if (!cancelled) setSites([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      // Wipe this user's cached data so the next sign-in starts clean.
      clearUserCache()
      router.push('/login')
    }
  }, [router, clearUserCache])

  // ── Menu items (grouped) ────────────────────────────────────────────────────
  const menuItems: MenuProps['items'] = useMemo(
    () =>
      NAV.map((group) => ({
        type: 'group' as const,
        key: group.title,
        label: group.title,
        children: group.items.map((item) => ({
          key: item.key,
          icon: item.icon,
          label: (
            <Tooltip title={item.hint} placement="right" mouseEnterDelay={0.3}>
              <span>{item.label}</span>
            </Tooltip>
          ),
        })),
      })),
    []
  )

  const selected = activeKey(pathname)
  const c = palette(mode)

  // ── Usage figures ───────────────────────────────────────────────────────────
  const plan: Plan = user?.plan ?? 'free'
  const rendersUsed = user?.render_count ?? 0
  const renderLimit = user?.render_limit ?? PLAN_LIMITS[plan].renders
  const usagePct = renderLimit > 0 ? Math.min(100, Math.round((rendersUsed / renderLimit) * 100)) : 0
  const usageColor = usagePct >= 90 ? '#ff4d4f' : usagePct >= 70 ? '#faad14' : BRAND

  // ── Avatar dropdown ─────────────────────────────────────────────────────────
  const userMenu: MenuProps['items'] = [
    { key: 'account', icon: <UserOutlined />, label: 'My Account' },
    { key: 'billing', icon: <CreditCardOutlined />, label: 'Billing' },
    { type: 'divider' },
    { key: 'logout', icon: <LogoutOutlined />, label: 'Logout', danger: true },
  ]
  const onUserMenu: MenuProps['onClick'] = ({ key }) => {
    if (key === 'account') router.push('/account')
    else if (key === 'billing') router.push('/dashboard/billing')
    else if (key === 'logout') handleLogout()
  }

  return (
    <AppProviders>
    <ConfigProvider
      theme={{
        algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
        // Tokens previously supplied by the now-removed root AntdProvider, folded
        // in here so the dashboard look is unchanged (compact text, green menu).
        token: { colorPrimary: BRAND, colorLink: BRAND, colorLinkHover: '#248217', borderRadius: 6, fontSize: 13 },
        components: {
          Menu: {
            itemSelectedBg: '#e8fae5',
            itemSelectedColor: '#2da01d',
            itemHoverBg: '#f9fafb',
            itemHoverColor: '#111827',
            iconSize: 15,
            itemHeight: 40,
            activeBarWidth: 0,
            activeBarBorderWidth: 0,
          },
          Button: { borderRadius: 6 },
          Drawer: { paddingLG: 0 },
        },
      }}
    >
      <DashboardContext.Provider value={{ user, selectedSiteId, setSelectedSiteId, sites }}>
        <Layout style={{ minHeight: '100vh', background: c.appBg }}>
          <Sider
            theme={mode}
            width={240}
            collapsedWidth={64}
            collapsible
            collapsed={collapsed}
            trigger={null}
            style={{
              background: c.siderBg,
              borderRight: `1px solid ${c.border}`,
              position: 'sticky',
              top: 0,
              height: '100vh',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {/* Logo */}
            <div
              style={{
                height: HEADER_HEIGHT,
                display: 'flex',
                alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'flex-start',
                padding: collapsed ? 0 : '0 20px',
                fontSize: 18,
                fontWeight: 700,
                whiteSpace: 'nowrap',
                borderBottom: `1px solid ${c.border}`,
              }}
            >
              {collapsed ? (
                <span>⚡</span>
              ) : (
                <span>
                  ⚡ <span style={{ color: c.logoRender }}>Render</span>
                  <span style={{ color: BRAND }}>ForAI</span>
                </span>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', height: `calc(100vh - ${HEADER_HEIGHT}px)` }}>
              {/* Navigation */}
              <div style={{ flex: 1, overflowY: 'auto' }}>
                <Menu
                  theme={mode}
                  mode="inline"
                  selectedKeys={[selected]}
                  items={menuItems}
                  style={{ background: 'transparent', borderInlineEnd: 'none' }}
                  onClick={({ key }) => router.push(key)}
                />
              </div>

              {/* Plan + usage footer */}
              {!collapsed && (
                <div style={{ padding: '12px 16px', borderTop: `1px solid ${c.border}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <Tag color={PLAN_COLOR[plan]} style={{ textTransform: 'capitalize', margin: 0 }}>
                      {plan}
                    </Tag>
                    {plan === 'free' && (
                      <a
                        onClick={() => router.push('/dashboard/billing')}
                        style={{ color: BRAND, fontSize: 12, cursor: 'pointer' }}
                      >
                        Upgrade
                      </a>
                    )}
                  </div>
                  <Progress
                    percent={usagePct}
                    showInfo={false}
                    strokeColor={usageColor}
                    trailColor={c.trail}
                    size="small"
                  />
                  <div style={{ fontSize: 11, color: c.sub, marginTop: 4 }}>
                    {rendersUsed.toLocaleString()} / {renderLimit.toLocaleString()} renders
                  </div>
                </div>
              )}

              {/* Collapse trigger */}
              <div style={{ padding: 8, borderTop: `1px solid ${c.border}`, textAlign: collapsed ? 'center' : 'right' }}>
                <Button
                  type="text"
                  size="small"
                  onClick={() => setCollapsed((prev) => !prev)}
                  icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  style={{ color: c.sub }}
                />
              </div>
            </div>
          </Sider>

          <Layout style={{ background: c.contentBg }}>
            <Header
              style={{
                height: HEADER_HEIGHT,
                lineHeight: `${HEADER_HEIGHT}px`,
                background: c.headerBg,
                borderBottom: `1px solid ${c.border}`,
                padding: '0 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                position: 'sticky',
                top: 0,
                zIndex: 10,
              }}
            >
              <div style={{ fontSize: 16, fontWeight: 600, color: c.title }}>{pageTitle(pathname)}</div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                {/* Account switcher (only shows if the user belongs to >1 account) */}
                <AccountSwitcher />

                {/* Theme toggle */}
                <Tooltip title={mode === 'dark' ? 'Switch to light' : 'Switch to dark'}>
                  <Button
                    type="text"
                    onClick={toggleTheme}
                    icon={
                      mode === 'dark' ? (
                        <BulbFilled style={{ color: '#faad14' }} />
                      ) : (
                        <BulbOutlined style={{ color: c.sub }} />
                      )
                    }
                  />
                </Tooltip>

                {/* Site selector */}
                <Select
                  value={selectedSiteId ?? undefined}
                  onChange={(v) => setSelectedSiteId(v)}
                  placeholder="Select site"
                  style={{ minWidth: 180 }}
                  size="small"
                  options={sites.map((s) => ({ value: s.id, label: s.name || s.domain }))}
                  notFoundContent="No sites yet"
                />

                {/* Usage circle */}
                <Tooltip title={`${rendersUsed.toLocaleString()} / ${renderLimit.toLocaleString()} renders`}>
                  <Progress
                    type="circle"
                    size={36}
                    percent={usagePct}
                    strokeColor={usageColor}
                    trailColor={c.trail}
                    format={(p) => <span style={{ fontSize: 10, color: c.sub }}>{p}%</span>}
                  />
                </Tooltip>

                {/* 🔔 Notification Bell */}
                <Popover
                  open={bellOpen}
                  onOpenChange={setBellOpen}
                  trigger="click"
                  placement="bottomRight"
                  title={
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 300 }}>
                      <span style={{ fontWeight: 600 }}>Notifications</span>
                      {unreadCount > 0 && (
                        <Button type="link" size="small" style={{ padding: 0, color: BRAND }} onClick={markAllRead}>
                          Mark all read
                        </Button>
                      )}
                    </div>
                  }
                  content={
                    notifs.length === 0 ? (
                      <Empty description="No notifications yet" image={Empty.PRESENTED_IMAGE_SIMPLE} style={{ margin: '12px 0' }} />
                    ) : (
                      <List
                        style={{ maxHeight: 360, overflowY: 'auto', minWidth: 300 }}
                        dataSource={[...notifs].reverse()}
                        renderItem={(n) => (
                          <List.Item
                            style={{
                              padding: '8px 0',
                              borderBottom: '1px solid #f0f0f0',
                              opacity: n.read ? 0.55 : 1,
                            }}
                          >
                            <div>
                              <div style={{ fontSize: 13, color: n.read ? '#888' : '#1f2937' }}>
                                {!n.read && <span style={{ color: BRAND, marginRight: 6 }}>●</span>}
                                {n.text}
                              </div>
                              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{n.time}</div>
                            </div>
                          </List.Item>
                        )}
                      />
                    )
                  }
                >
                  <Badge count={unreadCount} size="small" offset={[-2, 2]}>
                    <Button
                      type="text"
                      icon={<BellOutlined style={{ fontSize: 17, color: c.sub }} />}
                      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      aria-label="Notifications"
                    />
                  </Badge>
                </Popover>

                {/* Avatar + dropdown */}
                <Dropdown menu={{ items: userMenu, onClick: onUserMenu }} trigger={['click']} placement="bottomRight">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                    <Avatar
                      size={32}
                      src={user?.avatar_url || undefined}
                      style={{ background: BRAND, fontSize: 13 }}
                    >
                      {!user?.avatar_url && initials(user)}
                    </Avatar>
                    <span style={{ color: c.sub, fontSize: 13, maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {user?.full_name || user?.email || '…'}
                    </span>
                  </div>
                </Dropdown>
              </div>
            </Header>

            <Content style={{ background: c.contentBg }}>
              <main style={{ padding: 24, minHeight: '100vh', overflow: 'auto' }}>
                {showWpReminder && (
                  <Alert
                    type="info"
                    showIcon
                    closable
                    onClose={dismissWpReminder}
                    style={{ marginBottom: 16 }}
                    message="Install the WordPress plugin for the best experience"
                    description={
                      <div>
                        <p style={{ margin: '4px 0 8px' }}>
                          Your WordPress site is caching pages, but the plugin makes it <strong>fully automatic</strong>:
                        </p>
                        <ul style={{ margin: '0 0 8px', paddingLeft: 20 }}>
                          <li>✅ <strong>Zero code</strong> — one-click install from WordPress admin</li>
                          <li>✅ <strong>Auto-detects bots</strong> — serves prerendered HTML to crawlers</li>
                          <li>✅ <strong>Instant cache refresh</strong> — updates cache when you publish/edit posts</li>
                          <li>✅ <strong>No server config needed</strong> — no Cloudflare, no Nginx rules</li>
                        </ul>
                        <Link href="/integration-wizard">
                          <Button type="primary" size="small" style={{ background: BRAND, borderColor: BRAND }}>
                            Go to Integration Guide
                          </Button>
                        </Link>
                      </div>
                    }
                  />
                )}
                {children}
              </main>
            </Content>
          </Layout>
        </Layout>
      </DashboardContext.Provider>
    </ConfigProvider>
    </AppProviders>
  )
}
