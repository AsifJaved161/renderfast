import { NextRequest, NextResponse } from 'next/server'
import { isGscConfigured, buildAuthUrl } from '@/lib/gsc'
import crypto from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/gsc/connect — kick off the OAuth consent flow ───────────────────
// A browser navigation (carries the session cookie → middleware injects uid).
// Sets a signed `state` in an httpOnly cookie to defend against CSRF, then
// redirects the user to Google's consent screen.
export async function GET(req: NextRequest) {
  const uid = req.headers.get('x-user-id')
  if (!uid) return NextResponse.redirect(new URL('/login', req.url))

  if (!isGscConfigured()) {
    return NextResponse.redirect(new URL('/gsc?error=not_configured', req.url))
  }

  // state = random nonce; bind it to the user and verify on callback.
  const nonce = crypto.randomBytes(16).toString('hex')
  const state = `${uid}.${nonce}`

  const res = NextResponse.redirect(buildAuthUrl(state))
  res.cookies.set('gsc_oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 min
    path: '/',
  })
  return res
}
