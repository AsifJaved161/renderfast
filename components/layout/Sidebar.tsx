'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { X, Zap } from 'lucide-react'
import { navGroups, type NavItem } from '@/config/navigation'
import { cn } from '@/lib/utils'
import Logo from './Logo'

interface SidebarProps {
  open: boolean
  onClose: () => void
}

function NavLink({ item, onClick }: { item: NavItem; onClick: () => void }) {
  const pathname = usePathname()
  const isActive =
    pathname === item.href || pathname.startsWith(item.href + '/')

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-brand-50 text-brand-600'
          : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
      )}
    >
      <item.icon
        className={cn('h-4 w-4 shrink-0', isActive ? 'text-brand-600' : 'text-gray-400')}
        aria-hidden="true"
      />
      <span className="flex-1 truncate">{item.label}</span>
      {item.badge && (
        <span className="rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-purple-700">
          {item.badge}
        </span>
      )}
    </Link>
  )
}

function SidebarContent({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <nav className="flex-1 space-y-6 px-3 py-4" aria-label="Main navigation">
        {navGroups.map((group, groupIndex) => (
          <div key={groupIndex}>
            {group.groupLabel && (
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-widest text-gray-400">
                {group.groupLabel}
              </p>
            )}
            <ul className="space-y-0.5" role="list">
              {group.items.map((item) => (
                <li key={item.href}>
                  <NavLink item={item} onClick={onClose} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="m-3 rounded-xl border border-brand-100 bg-brand-50 p-4">
        <div className="mb-2 flex items-center gap-2">
          <Zap className="h-4 w-4 text-brand-600" aria-hidden="true" />
          <span className="text-xs font-semibold text-brand-700">Free Trial</span>
        </div>
        <p className="mb-3 text-xs text-gray-600">30 days left on your trial</p>
        <button
          type="button"
          className="w-full rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
        >
          Upgrade Now
        </button>
      </div>
    </div>
  )
}

export default function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname()

  useEffect(() => {
    onClose()
  }, [pathname, onClose])

  return (
    <>
      {/* Desktop sidebar — always visible */}
      <aside
        className="fixed bottom-0 left-0 top-16 hidden w-72 border-r border-gray-100 bg-white lg:flex lg:flex-col"
        aria-label="Dashboard sidebar"
      >
        <SidebarContent onClose={onClose} />
      </aside>

      {/* Mobile drawer */}
      <aside
        className={cn(
          'fixed bottom-0 left-0 top-0 z-30 flex w-72 flex-col border-r border-gray-100 bg-white transition-transform duration-300 ease-in-out lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="Dashboard sidebar"
        aria-hidden={!open}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 px-4">
          <Logo />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            aria-label="Close navigation sidebar"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <SidebarContent onClose={onClose} />
      </aside>
    </>
  )
}
