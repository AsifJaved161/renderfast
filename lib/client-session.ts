'use client'

import { useCallback } from 'react'
import { useSWRConfig } from 'swr'

// Single source of truth for clearing all *user-scoped* client storage, so one
// account can never see another account's data after a login/logout in the same
// browser. The server is already per-user safe (middleware injects a verified
// x-user-id); this guards the client-side caches that would otherwise paint a
// previous user's data instantly from storage.

export const SWR_CACHE_KEY = 'rf-swr-cache'

// User-specific localStorage keys cleared on auth change. NOTE: 'rf:theme' is
// intentionally excluded — it's a per-device display preference, not user data.
const USER_LOCAL_KEYS = ['rf:selectedSiteId', 'rf:phone', 'rf_onboarded']

export function clearUserClientState() {
  try {
    sessionStorage.removeItem(SWR_CACHE_KEY)
  } catch {
    /* private mode / quota — ignore */
  }
  try {
    for (const k of USER_LOCAL_KEYS) localStorage.removeItem(k)
  } catch {
    /* ignore */
  }
}

// The signed-in user id, published as a JS-readable cookie (`rf_uid`) by the auth
// routes + middleware. Used to scope the persisted SWR cache to its owner.
export function currentUid(): string {
  if (typeof document === 'undefined') return ''
  const m = document.cookie.match(/(?:^|;\s*)rf_uid=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : ''
}

// Clears every in-memory SWR entry AND the persisted client state. Call this on
// login and logout so a new session never inherits the previous user's cache.
export function useClearUserCache() {
  const { mutate } = useSWRConfig()
  return useCallback(() => {
    // Drop all cached keys without triggering a revalidation.
    mutate(() => true, undefined, { revalidate: false })
    clearUserClientState()
  }, [mutate])
}
