import { Spin } from 'antd'

export default function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0f0f0f',
      }}
    >
      <Spin size="large" />
    </div>
  )
}
