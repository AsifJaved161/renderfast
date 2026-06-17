'use client'

import React from 'react'
import type { DbUser, DbSite } from '@/lib/supabase'

export interface DashboardContextValue {
  user: DbUser | null
  selectedSiteId: string | null
  setSelectedSiteId: (id: string | null) => void
  sites: DbSite[]
}

export const DashboardContext = React.createContext<DashboardContextValue>({
  user: null,
  selectedSiteId: null,
  setSelectedSiteId: () => {},
  sites: [],
})

// Convenience hook so child pages can `const { user } = useDashboard()`.
export function useDashboard() {
  return React.useContext(DashboardContext)
}
