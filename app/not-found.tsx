import Link from 'next/link'

export default function NotFound() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: 24,
        background: '#0f0f0f',
        color: '#ffffff',
      }}
    >
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 22, marginBottom: 16 }}>
        <span>⚡</span>
        <span style={{ color: '#ffffff' }}>Render</span>
        <span style={{ color: '#2da01d', marginLeft: -4 }}>Fast</span>
      </div>
      <h1 style={{ fontSize: 64, fontWeight: 800, color: '#2da01d', margin: 0 }}>404</h1>
      <p style={{ fontSize: 18, color: '#e5e7eb', margin: '8px 0 4px' }}>Page Not Found</p>
      <p style={{ fontSize: 14, color: '#9ca3af', margin: '0 0 24px' }}>
        This page wandered off the sitemap.
      </p>
      <Link
        href="/dashboard"
        style={{
          background: '#2da01d',
          color: '#ffffff',
          textDecoration: 'none',
          padding: '10px 24px',
          borderRadius: 8,
          fontWeight: 600,
        }}
      >
        Go to Dashboard
      </Link>
    </div>
  )
}
