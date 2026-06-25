'use client'

import { SWRConfig } from 'swr'
import { SWR_CACHE_KEY, currentUid } from '@/lib/client-session'

// Global data-fetching layer (SWR).
//
// Why: every dashboard view used to refetch from scratch on each mount/refresh,
// flashing a skeleton each time. SWR keeps one in-memory cache keyed by URL, so:
//   • revisiting a tab shows the cached data instantly (no skeleton),
//   • the same key requested in two places makes a single request (dedup),
//   • data refreshes in the background (stale-while-revalidate).
// The cache is also persisted to sessionStorage, so even a hard refresh (F5)
// paints from cache immediately, then revalidates.
//
// SECURITY: the persisted cache is STAMPED with the signed-in user's id (the
// `rf_uid` cookie) and only reused when that id matches the user signed in right
// now. A different (or absent) uid → start empty, so one account can never paint
// another account's cached responses after a login/logout in the same browser.

// Default fetcher: any useSWR(url) does GET url → json, throwing on non-2xx so
// SWR surfaces the error instead of caching a bad body.
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
}

// Persistent cache provider. Hydrates the SWR Map from sessionStorage on load
// ONLY when the stored cache belongs to the current user, and flushes it back
// (stamped with the current uid) on unload. Guarded for SSR / private mode.
function cacheProvider() {
  if (typeof window === 'undefined') return new Map()
  const uid = currentUid()
  let map = new Map<string, unknown>()
  try {
    const raw = JSON.parse(sessionStorage.getItem(SWR_CACHE_KEY) || 'null')
    if (uid && raw && raw.uid === uid && Array.isArray(raw.entries)) {
      map = new Map<string, unknown>(raw.entries)
    } else {
      // No user, or cache belongs to someone else → never reuse it.
      sessionStorage.removeItem(SWR_CACHE_KEY)
    }
  } catch {
    map = new Map()
  }
  window.addEventListener('beforeunload', () => {
    try {
      sessionStorage.setItem(
        SWR_CACHE_KEY,
        JSON.stringify({ uid: currentUid(), entries: Array.from(map.entries()) })
      )
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
