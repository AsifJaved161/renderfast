export default function DashboardPage() {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#ffffff',
        borderRadius: 12,
        border: '2px dashed #e5e7eb',
      }}
    >
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: 14, fontWeight: 500, color: '#6b7280', margin: 0 }}>
          Layout shell is working
        </p>
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>
          Page content will go here — Phase 2
        </p>
      </div>
    </div>
  )
}
