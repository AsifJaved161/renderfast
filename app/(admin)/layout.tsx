'use client'

import { useState, useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ConfigProvider, theme, Layout, Spin } from 'antd'
import AdminSidebar from '@/components/admin/AdminSidebar'
import AdminHeader from '@/components/admin/AdminHeader'

const BRAND = '#2da01d'

const adminTheme = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: BRAND,
    colorLink: BRAND,
    colorBgBase: '#0f0f0f',
    borderRadius: 8,
  },
  components: {
    Layout: { siderBg: '#141414', headerBg: '#141414', bodyBg: '#0f0f0f' },
    Menu: { darkItemBg: '#141414', darkItemSelectedBg: 'rgba(45,160,29,0.18)', darkItemSelectedColor: BRAND },
  },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [allowed, setAllowed] = useState(false)

  // The login page renders without the chrome / auth gate.
  const isLoginPage = pathname === '/admin/login'

  useEffect(() => {
    if (isLoginPage) {
      setChecking(false)
      return
    }
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user?.is_admin) {
          setAllowed(true)
        } else {
          router.replace(d.user ? '/dashboard' : '/admin/login')
        }
      })
      .catch(() => router.replace('/admin/login'))
      .finally(() => setChecking(false))
  }, [isLoginPage, router])

  if (isLoginPage) {
    return <ConfigProvider theme={adminTheme}>{children}</ConfigProvider>
  }

  return (
    <ConfigProvider theme={adminTheme}>
      {checking || !allowed ? (
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0f0f0f' }}>
          <Spin size="large" />
        </div>
      ) : (
        <Layout style={{ minHeight: '100vh', background: '#0f0f0f' }}>
          <AdminSidebar />
          <Layout style={{ background: '#0f0f0f' }}>
            <AdminHeader />
            <Layout.Content style={{ padding: 24 }}>{children}</Layout.Content>
          </Layout>
        </Layout>
      )}
    </ConfigProvider>
  )
}
