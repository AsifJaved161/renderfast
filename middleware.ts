import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Dashboard-facing API namespaces whose route handlers read `x-user-id`.
// For these we inject a verified user id from the session (see below).
const INJECT_API_PREFIXES = [
  '/api/sites',
  '/api/analytics',
  '/api/sitemaps',
  '/api/queue',
  '/api/broken-links',
  '/api/cache',
  '/api/diagnostics',
  '/api/bot-cost',
  '/api/gsc',
]

function isInjectableApi(pathname: string): boolean {
  return INJECT_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname

  // Strip any client-supplied x-user-id so it can never be spoofed.
  const requestHeaders = new Headers(request.headers)
  requestHeaders.delete('x-user-id')

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  // Supabase not configured yet — skip auth gating instead of crashing.
  if (!supabaseUrl || !supabaseAnonKey) {
    console.warn(
      '[middleware] Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY — ' +
        'auth checks are disabled. Create .env.local from .env.local.example.'
    )
    return NextResponse.next({ request: { headers: requestHeaders } })
  }

  // Collect any session-refresh cookies Supabase wants to set, then apply them
  // to whatever final response (next / redirect) we return.
  const cookiesToApply: { name: string; value: string; options: CookieOptions }[] = []

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          request.cookies.set(name, value)
          cookiesToApply.push({ name, value, options })
        })
      },
    },
  })

  function finalize(res: NextResponse): NextResponse {
    cookiesToApply.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
    return res
  }

  // ── API routes: inject a VERIFIED user id ────────────────────────────────────
  // getUser() validates the JWT signature with Supabase (spoof-proof) — required
  // because the route handlers trust x-user-id for data access.
  if (isInjectableApi(pathname)) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) requestHeaders.set('x-user-id', user.id)
    return finalize(NextResponse.next({ request: { headers: requestHeaders } }))
  }

  // ── Page routes: gate with getSession() ──────────────────────────────────────
  // getSession() reads the session from the cookie (no auth-server round-trip on
  // the common valid-token path), so navigation is fast. This only decides which
  // UI shell to show — every API call still verifies via getUser(), so a forged
  // cookie can reveal no data.
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const signedIn = !!session?.user

  if (pathname.startsWith('/dashboard') && !signedIn)
    return finalize(NextResponse.redirect(new URL('/login', request.url)))

  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login') && !signedIn)
    return finalize(NextResponse.redirect(new URL('/admin/login', request.url)))

  if ((pathname === '/login' || pathname === '/signup') && signedIn)
    return finalize(NextResponse.redirect(new URL('/dashboard', request.url)))

  return finalize(NextResponse.next({ request: { headers: requestHeaders } }))
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/login',
    '/signup',
    '/api/sites/:path*',
    '/api/analytics',
    '/api/sitemaps/:path*',
    '/api/queue/:path*',
    '/api/broken-links/:path*',
    '/api/cache/:path*',
    '/api/cache',
    '/api/diagnostics/:path*',
    '/api/bot-cost/:path*',
    '/api/gsc',
    '/api/gsc/:path*',
  ],
}
