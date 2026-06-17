'use client'

import { useState, useCallback } from 'react'
import AntdProvider from './AntdProvider'
import AppHeader from './AppHeader'
import AppSidebar, { SIDEBAR_WIDTH } from './AppSidebar'

const HEADER_HEIGHT = 64

interface DashboardLayoutProps {
  children: React.ReactNode
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleMenuClick = useCallback(() => setMobileOpen((prev) => !prev), [])
  const handleClose = useCallback(() => setMobileOpen(false), [])

  return (
    <AntdProvider>
      {/* Fixed header */}
      <AppHeader onMenuClick={handleMenuClick} />

      {/* Fixed sidebar (desktop) + Drawer (mobile) */}
      <AppSidebar mobileOpen={mobileOpen} onClose={handleClose} />

      {/* Main content area */}
      <main
        style={{
          marginTop: HEADER_HEIGHT,
          minHeight: `calc(100vh - ${HEADER_HEIGHT}px)`,
          background: '#f9fafb',
          transition: 'padding-left 0.2s',
        }}
        className="lg:pl-[280px]"
      >
        <div
          style={{
            maxWidth: 1536,
            margin: '0 auto',
            padding: '24px 16px',
          }}
          className="sm:px-6 lg:px-8"
        >
          {children}
        </div>
      </main>
    </AntdProvider>
  )
}
