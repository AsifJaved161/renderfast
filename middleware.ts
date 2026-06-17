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
  '/api/seo',
  '/api/diagnostics',
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

  // getUser() verifies the JWT signature with Supabase (spoof-proof).
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Inject the verified id for dashboard API routes.
  if (user && isInjectableApi(pathname)) {
    requestHeaders.set('x-user-id', user.id)
  }

  function finalize(res: NextResponse): NextResponse {
    cookiesToApply.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
    return res
  }

  // ── Page gating / redirects ──────────────────────────────────────────────────
  if (pathname.startsWith('/dashboard') && !user)
    return finalize(NextResponse.redirect(new URL('/login', request.url)))

  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login') && !user)
    return finalize(NextResponse.redirect(new URL('/admin/login', request.url)))

  if ((pathname === '/login' || pathname === '/signup') && user)
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
    '/api/seo',
    '/api/diagnostics/:path*',
    '/api/gsc',
    '/api/gsc/:path*',
  ],
}
