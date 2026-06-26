// Global navigation fallback — pure CSS (no Ant Design), so the root shell ships
// zero component-library JS. Light surface to match the app's default theme.
export default function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f9fafb',
      }}
    >
      <span
        style={{
          width: 40,
          height: 40,
          border: '3px solid #e5e7eb',
          borderTopColor: '#2da01d',
          borderRadius: '50%',
          display: 'inline-block',
          animation: 'rf-spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes rf-spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
