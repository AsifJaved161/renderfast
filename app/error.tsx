'use client'

import { useEffect } from 'react'

const BRAND = '#2da01d'

// Root error boundary — pure HTML/CSS (no Ant Design) so the root shell carries
// no component-library JS. Kept deliberately minimal.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

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
        {error.message || 'An unexpected error occurred.'}
      </p>
      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={reset} style={{ ...btn, background: BRAND, borderColor: BRAND, color: '#fff' }}>
          Try again
        </button>
        <a href="/dashboard" style={{ ...btn, textDecoration: 'none' }}>
          Go to Dashboard
        </a>
      </div>
    </div>
  )
}
