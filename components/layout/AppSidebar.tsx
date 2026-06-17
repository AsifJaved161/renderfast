'use client'

import { Drawer } from 'antd'
import { X } from 'lucide-react'
import Logo from './Logo'
import SidebarMenu from './SidebarMenu'

export const SIDEBAR_WIDTH = 280

interface AppSidebarProps {
  mobileOpen: boolean
  onClose: () => void
}

export default function AppSidebar({ mobileOpen, onClose }: AppSidebarProps) {
  return (
    <>
      {/* ─── Desktop: fixed sidebar ─────────────────────────── */}
      <aside
        className="hidden lg:flex lg:flex-col"
        style={{
          position: 'fixed',
          top: 64,
          left: 0,
          bottom: 0,
          width: SIDEBAR_WIDTH,
          background: '#ffffff',
          borderRight: '1px solid #f0f0f0',
          zIndex: 100,
          overflowY: 'auto',
        }}
      >
        <SidebarMenu />
      </aside>

      {/* ─── Mobile: antd Drawer ────────────────────────────── */}
      <Drawer
        placement="left"
        open={mobileOpen}
        onClose={onClose}
        width={SIDEBAR_WIDTH}
        closeIcon={<X size={18} />}
        title={<Logo />}
        styles={{
          header: {
            height: 64,
            padding: '0 16px',
            borderBottom: '1px solid #f0f0f0',
            display: 'flex',
            alignItems: 'center',
          },
          body: { padding: 0 },
        }}
        style={{ top: 0 }}
        className="lg:hidden"
      >
        <SidebarMenu onNavigate={onClose} />
      </Drawer>
    </>
  )
}
