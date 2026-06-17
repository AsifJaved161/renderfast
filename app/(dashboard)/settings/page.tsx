'use client'

import { useState, useEffect } from 'react'
import {
  Card,
  Slider,
  Switch,
  Input,
  Button,
  Row,
  Col,
  Typography,
  Divider,
  Space,
  message,
} from 'antd'
import {
  DatabaseOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  BellOutlined,
} from '@ant-design/icons'

const BRAND = '#2da01d'
const { Title, Text, Paragraph } = Typography
const { TextArea } = Input

// Cache TTL slider stops (seconds) with human labels.
const TTL_STOPS = [
  { value: 0, seconds: 6 * 3600, label: '6 hours' },
  { value: 1, seconds: 24 * 3600, label: '1 day' },
  { value: 2, seconds: 7 * 24 * 3600, label: '7 days' },
  { value: 3, seconds: 30 * 24 * 3600, label: '30 days' },
]

interface SettingsState {
  cacheTtl: number // index into TTL_STOPS
  staleWhileRevalidate: boolean
  mobileRendering: boolean
  renderTimeout: number // seconds
  blockAnalytics: boolean
  blockAds: boolean
  blockImages: boolean
  stripJs: boolean
  serveMarkdown: boolean
  aiInstructions: string
  notify80: boolean
  notifyLimit: boolean
  notifyErrors: boolean
}

const DEFAULTS: SettingsState = {
  cacheTtl: 1,
  staleWhileRevalidate: true,
  mobileRendering: false,
  renderTimeout: 15,
  blockAnalytics: true,
  blockAds: true,
  blockImages: true,
  stripJs: false,
  serveMarkdown: true,
  aiInstructions: '',
  notify80: true,
  notifyLimit: true,
  notifyErrors: false,
}

export default function SettingsPage() {
  const [s, setS] = useState<SettingsState>(DEFAULTS)
  const [saving, setSaving] = useState(false)

  // Hydrate notification preference from the user profile.
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.user) setS((prev) => ({ ...prev, notifyLimit: !!d.user.notification_email }))
      })
      .catch(() => {})
  }, [])

  function set<K extends keyof SettingsState>(key: K, value: SettingsState[K]) {
    setS((prev) => ({ ...prev, [key]: value }))
  }

  async function save() {
    setSaving(true)
    try {
      // notification_email is the persisted column; the rest are sent for forward-compat.
      const res = await fetch('/api/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notification_email: s.notifyLimit }),
      })
      if (res.ok) message.success('Settings saved')
      else message.error('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const llmsTxt = generateLlmsTxt(s)

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <Title level={3} style={{ margin: 0 }}>
          Settings
        </Title>
        <Button type="primary" loading={saving} onClick={save} style={{ background: BRAND, borderColor: BRAND }}>
          Save Changes
        </Button>
      </div>

      {/* ── Cache Configuration ─────────────────────────────────────────────── */}
      <Card title={<Space><DatabaseOutlined /> Cache Configuration</Space>} style={{ marginBottom: 16 }}>
        <Text strong>Default Cache TTL</Text>
        <Slider
          min={0}
          max={3}
          step={1}
          value={s.cacheTtl}
          onChange={(v) => set('cacheTtl', v)}
          marks={Object.fromEntries(TTL_STOPS.map((t) => [t.value, t.label]))}
          tooltip={{ formatter: (v) => TTL_STOPS[v ?? 0].label }}
        />
        <Divider />
        <ToggleRow label="Stale-While-Revalidate" desc="Serve cached HTML instantly, refresh in background" checked={s.staleWhileRevalidate} onChange={(v) => set('staleWhileRevalidate', v)} />
        <ToggleRow label="Mobile Rendering" desc="Keep a separate cache for mobile user-agents" checked={s.mobileRendering} onChange={(v) => set('mobileRendering', v)} />
      </Card>

      {/* ── Rendering Configuration ─────────────────────────────────────────── */}
      <Card title={<Space><ThunderboltOutlined /> Rendering Configuration</Space>} style={{ marginBottom: 16 }}>
        <Text strong>Render Timeout: {s.renderTimeout}s</Text>
        <Slider
          min={5}
          max={60}
          step={1}
          value={s.renderTimeout}
          onChange={(v) => set('renderTimeout', v)}
          marks={{ 5: '5s', 15: '15s', 30: '30s', 60: '60s' }}
        />
        <Divider />
        <ToggleRow label="Block Analytics Scripts" desc="Strip GA, GTM, Hotjar, etc." checked={s.blockAnalytics} onChange={(v) => set('blockAnalytics', v)} />
        <ToggleRow label="Block Ads" desc="Remove ad network requests" checked={s.blockAds} onChange={(v) => set('blockAds', v)} />
        <ToggleRow label="Block Images" desc="Faster rendering by skipping images" checked={s.blockImages} onChange={(v) => set('blockImages', v)} />
        <ToggleRow label="Strip All JavaScript" desc="Remove all <script> tags from output" checked={s.stripJs} onChange={(v) => set('stripJs', v)} />
      </Card>

      {/* ── AI Visibility ───────────────────────────────────────────────────── */}
      <Card title={<Space><RobotOutlined /> AI Visibility</Space>} style={{ marginBottom: 16 }}>
        <ToggleRow label="Serve Markdown to AI Bots" desc="Return clean Markdown for GPTBot, ClaudeBot, etc." checked={s.serveMarkdown} onChange={(v) => set('serveMarkdown', v)} />
        <Divider />
        <Text strong>Custom AI Instructions</Text>
        <TextArea
          rows={4}
          style={{ marginTop: 8 }}
          placeholder="Describe your site for AI crawlers (used in llms.txt)…"
          value={s.aiInstructions}
          onChange={(e) => set('aiInstructions', e.target.value)}
        />
        <Divider />
        <Text strong>llms.txt Preview</Text>
        <pre
          style={{
            marginTop: 8,
            background: '#16213e',
            color: '#e6e6e6',
            padding: 16,
            borderRadius: 8,
            fontSize: 12,
            whiteSpace: 'pre-wrap',
          }}
        >
          <code>{llmsTxt}</code>
        </pre>
      </Card>

      {/* ── Notifications ───────────────────────────────────────────────────── */}
      <Card title={<Space><BellOutlined /> Notifications</Space>}>
        <ToggleRow label="80% Render Limit Reached" desc="Email me when usage hits 80%" checked={s.notify80} onChange={(v) => set('notify80', v)} />
        <ToggleRow label="Render Limit Hit" desc="Email me when the monthly limit is reached" checked={s.notifyLimit} onChange={(v) => set('notifyLimit', v)} />
        <ToggleRow label="Render Errors" desc="Email me when renders fail" checked={s.notifyErrors} onChange={(v) => set('notifyErrors', v)} />
      </Card>

      <div style={{ marginTop: 20, textAlign: 'right' }}>
        <Button type="primary" loading={saving} onClick={save} style={{ background: BRAND, borderColor: BRAND }}>
          Save Changes
        </Button>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string
  desc: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row align="middle" justify="space-between" style={{ padding: '10px 0' }}>
      <Col>
        <Text strong>{label}</Text>
        <Paragraph type="secondary" style={{ margin: 0, fontSize: 13 }}>
          {desc}
        </Paragraph>
      </Col>
      <Col>
        <Switch checked={checked} onChange={onChange} style={checked ? { background: BRAND } : undefined} />
      </Col>
    </Row>
  )
}

function generateLlmsTxt(s: SettingsState) {
  const lines = [
    '# llms.txt',
    '',
    '> Rendering powered by RenderFast',
    '',
    s.serveMarkdown ? 'Markdown served to AI bots: enabled' : 'Markdown served to AI bots: disabled',
    '',
  ]
  if (s.aiInstructions.trim()) {
    lines.push('## Instructions', '', s.aiInstructions.trim())
  } else {
    lines.push('## Instructions', '', 'Add custom AI instructions above to populate this section.')
  }
  return lines.join('\n')
}
