import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'RenderForAI — WordPress Prerendering',
}

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
