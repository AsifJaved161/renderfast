import { NextRequest, NextResponse } from 'next/server'
import { isGscConfigured, exchangeCode, fetchGoogleEmail, saveConnection } from '@/lib/gsc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/gsc/callback — OAuth redirect target ────────────────────────────
// Google redirects here with ?code & ?state. We verify state (CSRF), exchange
// the code for tokens, store them, then send the user back to the GSC page.
export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  const error = url.searchParams.get('error')

  const fail = (reason: string) => NextResponse.redirect(new URL(`/gsc?error=${reason}`, req.url))

  if (error) return fail(error)
  if (!isGscConfigured()) return fail('not_configured')
  if (!code || !state) return fail('missing_code')

  // CSRF: the state must match the cookie we set in /connect.
  const cookieState = req.cookies.get('gsc_oauth_state')?.value
  if (!cookieState || cookieState !== state) return fail('bad_state')

  // The verified user id is the prefix of state ("<uid>.<nonce>"). Cross-check
  // against the session uid the middleware injected, so tokens can't be bound
  // to a different account.
  const uid = state.split('.')[0]
  const sessionUid = req.headers.get('x-user-id')
  if (!uid || (sessionUid && sessionUid !== uid)) return fail('bad_state')

  try {
    const tokens = await exchangeCode(code)
    const email = await fetchGoogleEmail(tokens.access_token)
    await saveConnection(uid, tokens, email)

    const res = NextResponse.redirect(new URL('/gsc?connected=1', req.url))
    res.cookies.delete('gsc_oauth_state')
    return res
  } catch (e) {
    console.error('[GSC_CALLBACK]:', e)
    return fail('exchange_failed')
  }
}
