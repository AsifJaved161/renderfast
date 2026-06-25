'use client'

import { useEffect } from 'react'
import { Button, Result, ConfigProvider, theme } from 'antd'

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

  return (
    <ConfigProvider theme={{ algorithm: theme.defaultAlgorithm, token: { colorPrimary: '#2da01d' } }}>
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f9fafb',
          padding: 24,
        }}
      >
        <Result
          status="error"
          title="Something went wrong"
          subTitle={error.message || 'An unexpected error occurred.'}
          extra={[
            <Button key="retry" type="primary" onClick={reset}>
              Try Again
            </Button>,
            <Button key="home" href="/dashboard">
              Go to Dashboard
            </Button>,
          ]}
        />
      </div>
    </ConfigProvider>
  )
}
