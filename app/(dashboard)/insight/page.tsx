'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, Alert, Empty, Typography, Skeleton } from 'antd'
import { GoogleOutlined } from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text } = Typography

// SEO Insights is now focused on Google Search Console data only. Per-page render
// diagnostics (SEO score + issues) moved to the dedicated "Bot Visibility" page.
export default function InsightPage() {
  const [gscConnected, setGscConnected] = useState<boolean | null>(null)

  useEffect(() => {
    fetch('/api/gsc')
      .then((r) => r.json())
      .then((d) => setGscConnected(!!d.connected))
      .catch(() => setGscConnected(false))
  }, [])

  return (
    <div style={{ padding: 24 }}>
      <div style={{ marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          SEO Insights
        </Title>
        <Text type="secondary">
          Search performance from Google Search Console — impressions, clicks, position & indexing.
        </Text>
      </div>

      {/* ── Google Search Console connect ───────────────────────────────────── */}
      {gscConnected === false && (
        <Alert
          type="info"
          showIcon
          icon={<GoogleOutlined />}
          style={{ marginBottom: 16 }}
          message="Connect Google Search Console for richer insights"
          description={
            <span>
              Impressions, clicks, average position and indexing status will appear here once
              GSC is connected.{' '}
              <Link href="/gsc" style={{ color: BRAND, fontWeight: 600 }}>
                Connect now →
              </Link>
            </span>
          }
        />
      )}

      <Card>
        {gscConnected === null ? (
          <Skeleton active paragraph={{ rows: 4 }} />
        ) : (
          <Empty
            description={
              gscConnected
                ? 'Loading your Search Console metrics…'
                : 'Connect Google Search Console to see impressions, clicks, average position and indexing status here.'
            }
          />
        )}
      </Card>
    </div>
  )
}
