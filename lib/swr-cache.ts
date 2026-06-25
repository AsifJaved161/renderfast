// Tiny stale-while-revalidate cache backed by sessionStorage.
//
// Used by the analytics dashboards so revisiting a view (or refreshing) shows
// the last-seen data instantly instead of flashing a skeleton every time; the
// page still refetches in the background and updates when fresh data arrives.
// Per-session only (cleared when the tab closes), so data never goes stale
// across sessions, and all access is guarded for private-mode / quota failures.

export function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore quota / private-mode failures */
  }
}
