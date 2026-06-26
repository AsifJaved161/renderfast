import type { Metadata } from 'next'
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

// Supabase origin (auth + OAuth + storage avatars). Preconnecting lets the
// browser open the TLS connection early so the first auth call isn't delayed —
// Google's "Preconnect to required origins" guidance.
const SUPABASE_ORIGIN = (() => {
  try {
    return new URL((process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()).origin
  } catch {
    return ''
  }
})()

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {SUPABASE_ORIGIN && (
          <>
            <link rel="preconnect" href={SUPABASE_ORIGIN} crossOrigin="" />
            <link rel="dns-prefetch" href={SUPABASE_ORIGIN} />
          </>
        )}
      </head>
      {/* No Ant Design / SWR here — those load only inside the (dashboard) and
          (admin) layouts (see AppProviders), so public auth pages stay light. */}
      <body style={{ margin: 0, padding: 0, fontFamily: FONT_STACK }}>{children}</body>
    </html>
  )
}
