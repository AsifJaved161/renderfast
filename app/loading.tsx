import { Spin } from 'antd'

// Global navigation fallback. Uses the app's default (light) surface colour so
// there's no dark→light flash on first load / route transitions — the dashboard
// defaults to light mode (see AntdProvider + the dashboard layout palette).
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
      <Spin size="large" />
    </div>
  )
}
