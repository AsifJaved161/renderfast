'use client'

import { SWRConfig } from 'swr'

// Global data-fetching layer (SWR).
//
// Why: every dashboard view used to refetch from scratch on each mount/refresh,
// flashing a skeleton each time. SWR keeps one in-memory cache keyed by URL, so:
//   • revisiting a tab shows the cached data instantly (no skeleton),
//   • the same key requested in two places makes a single request (dedup),
//   • data refreshes in the background (stale-while-revalidate).
// The cache is also persisted to sessionStorage, so even a hard refresh (F5)
// paints from cache immediately, then revalidates. sessionStorage (not local)
// means it's scoped to the tab/session and never goes stale across sessions.

// Default fetcher: any useSWR(url) does GET url → json, throwing on non-2xx so
// SWR surfaces the error instead of caching a bad body.
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

const CACHE_KEY = 'rf-swr-cache'

// Persistent cache provider. Hydrates the SWR Map from sessionStorage on load
// and flushes it back on unload. Guarded for SSR (no window) and private mode.
function cacheProvider() {
  if (typeof window === 'undefined') return new Map()
  let entries: [string, unknown][] = []
  try {
    entries = JSON.parse(sessionStorage.getItem(CACHE_KEY) || '[]')
  } catch {
    entries = []
  }
  const map = new Map<string, unknown>(entries)
  window.addEventListener('beforeunload', () => {
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(Array.from(map.entries())))
    } catch {
      /* ignore quota / private-mode failures */
    }
  })
  return map
}

export default function SWRProvider({ children }: { children: React.ReactNode }) {
  return (
    <SWRConfig
      value={{
        fetcher,
        provider: cacheProvider,
        revalidateOnFocus: false, // don't refetch every time the tab regains focus
        keepPreviousData: true, // show old data while a new key loads (no flash)
        dedupingInterval: 30_000, // collapse identical requests within 30s
      }}
    >
      {children}
    </SWRConfig>
  )
}
