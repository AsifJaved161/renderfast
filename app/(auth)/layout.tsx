import type { Metadata } from 'next'
import './auth.css'

export const metadata: Metadata = {
  title: 'RenderForAI — Sign in',
}

// Plain pass-through layout (no Ant Design). The auth pages are intentionally
// antd-free so these public, Google-crawled pages ship minimal JavaScript.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
