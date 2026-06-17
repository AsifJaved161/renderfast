'use client'

import Link from 'next/link'
import { Bell, ChevronDown, HelpCircle, Menu } from 'lucide-react'
import Logo from './Logo'

interface HeaderProps {
  onMenuClick: () => void
}

export default function Header({ onMenuClick }: HeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center border-b border-gray-100 bg-white px-4">
      <div className="flex flex-1 items-center gap-4">
        <button
          type="button"
          onClick={onMenuClick}
          className="rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 lg:hidden"
          aria-label="Toggle navigation sidebar"
        >
          <Menu className="h-5 w-5" aria-hidden="true" />
        </button>
        <Link href="/" className="flex shrink-0 items-center" aria-label="Prerender.io home">
          <Logo />
        </Link>
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium text-brand-600 transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          aria-label="Open support"
        >
          <HelpCircle className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">Support</span>
        </button>

        <button
          type="button"
          className="relative rounded-md p-2 text-gray-500 transition-colors hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          aria-label="View notifications"
        >
          <Bell className="h-5 w-5" aria-hidden="true" />
        </button>

        <div
          className="hidden h-9 w-9 items-center justify-center rounded-full border-2 border-gray-200 md:flex"
          role="meter"
          aria-valuenow={0}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Render usage: 0%"
        >
          <span className="text-[10px] font-semibold text-gray-500">0%</span>
        </div>

        <button
          type="button"
          className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          aria-label="User menu"
          aria-haspopup="true"
        >
          <div className="hidden text-right sm:block">
            <p className="text-xs font-semibold leading-tight text-gray-800">Asif</p>
            <p className="text-[11px] leading-tight text-gray-500">Account Owner</p>
          </div>
          <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
        </button>
      </div>
    </header>
  )
}
