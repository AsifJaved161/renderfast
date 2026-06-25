import type { Metadata } from 'next'
import { AntdRegistry } from '@ant-design/nextjs-registry'
import AntdProvider from '@/components/layout/AntdProvider'
import SWRProvider from '@/components/providers/SWRProvider'
import './globals.css'

// System font stack (uses Inter if installed locally, else native UI fonts).
// Avoids a build-time fetch to Google Fonts so the build works fully offline.
const FONT_STACK =
  "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

export const metadata: Metadata = {
  title: {
    template: '%s | RenderForAI',
    default: 'RenderForAI — SEO Rendering for SPAs',
  },
  description:
    'RenderForAI prerenders your single-page app for search engines and AI bots — faster indexing, better SEO, zero infrastructure.',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: FONT_STACK }}>
        <SWRProvider>
          <AntdRegistry>
            <AntdProvider>{children}</AntdProvider>
          </AntdRegistry>
        </SWRProvider>
      </body>
    </html>
  )
}
