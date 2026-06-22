'use client'

import { useEffect, useState } from 'react'
import { Select, Tag, message } from 'antd'
import { SwapOutlined } from '@ant-design/icons'

interface Account {
  id: string
  name: string
  role: string
  isCurrent: boolean
}

// Header control to switch between the user's own account and any team accounts
// they belong to. Self-fetches; renders nothing unless the user has >1 account,
// so it's invisible/zero-impact for solo users.
export function AccountSwitcher() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [current, setCurrent] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    fetch('/api/team')
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (cancelled) return
        setAccounts(d.accounts ?? [])
        setCurrent((d.accounts ?? []).find((a: Account) => a.isCurrent)?.id ?? d.accountId)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (accounts.length <= 1) return null

  async function switchTo(accountId: string) {
    try {
      const res = await fetch('/api/team/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      })
      if (res.ok) window.location.reload()
      else message.error('Switch failed')
    } catch {
      message.error('Switch failed')
    }
  }

  return (
    <Select
      size="small"
      value={current}
      onChange={switchTo}
      style={{ minWidth: 170 }}
      suffixIcon={<SwapOutlined />}
      options={accounts.map((a) => ({
        value: a.id,
        label: (
          <span>
            {a.name} <Tag style={{ marginInlineStart: 4 }}>{a.role}</Tag>
          </span>
        ),
      }))}
    />
  )
}
