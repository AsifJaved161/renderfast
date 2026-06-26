'use client'

import { useState } from 'react'
import { Card, Input, Switch, Button, Row, Col, Typography, message } from 'antd'
import type { SiteSettings } from '@/lib/site-settings'

const BRAND = '#2da01d'
const { Text, Paragraph } = Typography
const { TextArea } = Input

const linesToArr = (s: string): string[] => s.split('\n').map((l) => l.trim()).filter(Boolean)
const arrToLines = (a?: string[]): string => (a ?? []).join('\n')

// "Key: Value" lines ⇄ object.
function linesToHeaders(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const l of s.split('\n')) {
    const i = l.indexOf(':')
    if (i > 0) {
      const k = l.slice(0, i).trim()
      const v = l.slice(i + 1).trim()
      if (k) out[k] = v
    }
  }
  return out
}
const headersToLines = (h?: Record<string, string>): string =>
  Object.entries(h ?? {}).map(([k, v]) => `${k}: ${v}`).join('\n')

// "pattern = days" lines ⇄ [{pattern, days}].
function linesToExpiry(s: string): { pattern: string; days: number }[] {
  const out: { pattern: string; days: number }[] = []
  for (const l of s.split('\n')) {
    const i = l.lastIndexOf('=')
    if (i > 0) {
      const pattern = l.slice(0, i).trim()
      const days = Number(l.slice(i + 1).trim())
      if (pattern && Number.isFinite(days)) out.push({ pattern, days: Math.max(0, Math.round(days)) })
    }
  }
  return out
}
const expiryToLines = (e?: { pattern: string; days: number }[]): string =>
  (e ?? []).map((r) => `${r.pattern} = ${r.days}`).join('\n')

export function SiteAdvancedSettings({
  siteId,
  initial,
  onSaved,
}: {
  siteId: string
  initial?: Partial<SiteSettings> | null
  onSaved?: () => void
}) {
  const [excludedPaths, setExcludedPaths] = useState(arrToLines(initial?.excludedPaths))
  const [entryPoints, setEntryPoints] = useState(arrToLines(initial?.entryPoints))
  const [blockResources, setBlockResources] = useState(arrToLines(initial?.blockResources))
  const [headers, setHeaders] = useState(headersToLines(initial?.headers))
  const [pathExpiry, setPathExpiry] = useState(expiryToLines(initial?.pathExpiry))
  const [userAgent, setUserAgent] = useState(initial?.userAgent ?? '')
  const [emulateMobile, setEmulateMobile] = useState(!!initial?.emulateMobile)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    try {
      const settings: SiteSettings = {
        excludedPaths: linesToArr(excludedPaths),
        entryPoints: linesToArr(entryPoints),
        blockResources: linesToArr(blockResources),
        headers: linesToHeaders(headers),
        pathExpiry: linesToExpiry(pathExpiry),
        userAgent: userAgent.trim(),
        emulateMobile,
      }
      const res = await fetch(`/api/sites/${siteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settings }),
      })
      if (!res.ok) {
        message.error('Could not save settings')
        return
      }
      message.success('Advanced settings saved')
      onSaved?.()
    } catch {
      message.error('Network error')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, hint: string, node: React.ReactNode) => (
    <div style={{ marginBottom: 16 }}>
      <Text strong>{label}</Text>
      <Paragraph type="secondary" style={{ margin: '2px 0 6px', fontSize: 12 }}>{hint}</Paragraph>
      {node}
    </div>
  )

  return (
    <Card title="Advanced Settings" style={{ marginTop: 20 }}>
      <Row align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col><Text strong>Emulate mobile device</Text><Paragraph type="secondary" style={{ margin: 0, fontSize: 12 }}>Render with a mobile viewport &amp; user-agent.</Paragraph></Col>
        <Col><Switch checked={emulateMobile} onChange={setEmulateMobile} style={emulateMobile ? { background: BRAND } : undefined} /></Col>
      </Row>

      {field('Excluded paths', 'One per line. Paths starting with these (or matching a * glob) are never prerendered — bots get the origin page.',
        <TextArea rows={3} value={excludedPaths} onChange={(e) => setExcludedPaths(e.target.value)} placeholder={'/admin\n/cart\n/preview/*'} />)}

      {field('Entry points', 'Extra URLs/paths to crawl (pages not reachable via the sitemap, or that you always want captured). One per line.',
        <TextArea rows={3} value={entryPoints} onChange={(e) => setEntryPoints(e.target.value)} placeholder={'/sitemap-extra\n/hidden-landing'} />)}

      {field('Blocked resources', 'URL fragments to block while rendering (ads, trackers, heavy widgets) — faster, cleaner renders. One per line.',
        <TextArea rows={3} value={blockResources} onChange={(e) => setBlockResources(e.target.value)} placeholder={'googletagmanager.com\n/ads/\nhotjar'} />)}

      {field('Custom request headers', 'Sent by the renderer on every request for this site. "Key: Value", one per line.',
        <TextArea rows={3} value={headers} onChange={(e) => setHeaders(e.target.value)} placeholder={'X-Bypass-Cache: 1\nAuthorization: Bearer …'} />)}

      {field('Per-path cache expiry', 'Override how long a page stays fresh before re-checking. "regex = days", one per line.',
        <TextArea rows={2} value={pathExpiry} onChange={(e) => setPathExpiry(e.target.value)} placeholder={'^/blog/ = 7\n^/products/ = 1'} />)}

      {field('Custom user-agent', 'Sent by the renderer when capturing this site (blank = default).',
        <Input value={userAgent} onChange={(e) => setUserAgent(e.target.value)} placeholder="Mozilla/5.0 … MySiteRenderer/1.0" />)}

      <Button type="primary" loading={saving} onClick={save} style={{ background: BRAND, borderColor: BRAND }}>
        Save Advanced Settings
      </Button>
    </Card>
  )
}
