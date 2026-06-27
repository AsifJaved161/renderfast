'use client'

import { useEffect } from 'react'

const BRAND = '#2da01d'

// A stale-chunk error: the browser is referencing an old build's JS chunk that no
// longer exists (happens right after a redeploy/rebuild). reset() can't recover
// it — only a full reload fetches fresh HTML pointing at the current chunks.
function isChunkLoadError(error: Error): boolean {
  return (
    error.name === 'ChunkLoadError' ||
    /Loading chunk|Failed to load chunk|Loading CSS chunk|dynamically imported module/i.test(
      error.message || ''
    )
  )
}

const RELOAD_KEY = 'rf:chunk-reload-at'

// Root error boundary — pure HTML/CSS (no Ant Design) so the root shell carries
// no component-library JS. Kept deliberately minimal.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const chunkError = isChunkLoadError(error)

  useEffect(() => {
    console.error(error)
    // Auto-recover from a stale chunk by reloading once. The timestamp guard
    // stops an infinite reload loop if the chunk is genuinely gone.
    if (chunkError && typeof window !== 'undefined') {
      const last = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
        window.location.reload()
      }
    }
  }, [error, chunkError])

  const btn: React.CSSProperties = {
    padding: '8px 18px',
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: '1px solid #d9d9d9',
    background: '#fff',
    color: '#1f2937',
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
        padding: 24,
        textAlign: 'center',
        fontFamily: 'inherit',
      }}
    >
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#1f2937', margin: '0 0 8px' }}>
        Something went wrong
      </h1>
      <p style={{ color: '#6b7280', maxWidth: 440, margin: '0 0 24px' }}>
        {chunkError
          ? 'A new version of the app was deployed. Reloading to get the latest…'
          : error.message || 'An unexpected error occurred.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button
          onClick={() => (chunkError ? window.location.reload() : reset())}
          style={{ ...btn, background: BRAND, borderColor: BRAND, color: '#fff' }}
        >
          Try again
        </button>
        <a href="/dashboard" style={{ ...btn, textDecoration: 'none' }}>
          Go to Dashboard
        </a>
      </div>
    </div>
  )
}
