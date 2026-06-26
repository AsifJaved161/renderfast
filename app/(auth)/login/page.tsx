'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clearUserClientState } from '@/lib/client-session'
import BrandPanel from '../BrandPanel'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Login failed')
        return
      }
      // Drop any cache left by a previous account before entering the app.
      clearUserClientState()
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function signInWithGoogle() {
    setGoogleLoading(true)
    clearUserClientState() // clear any prior account's cache before redirecting
    // Lazy-load the Supabase browser client only on Google click → keeps it out
    // of the initial login bundle (email/password sign-in goes via /api/auth/login).
    const { getSupabaseBrowser } = await import('@/lib/supabase-browser')
    const supabase = getSupabaseBrowser()
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/api/auth/callback`,
        queryParams: { prompt: 'select_account' },
      },
    })
  }

  return (
    <div className="auth-page">
      <div className="auth-form-col">
        <div className="auth-form-inner">
          <h1 className="auth-h1">Welcome back</h1>
          <p className="auth-sub">Sign in to your RenderForAI account</p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={onSubmit} noValidate={false}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email"
                className="auth-input" placeholder="you@example.com" />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="password">Password</label>
              <div className="auth-input-wrap">
                <input id="password" name="password" type={showPw ? 'text' : 'password'} required
                  autoComplete="current-password" className="auth-input" placeholder="••••••••" />
                <button type="button" className="auth-toggle" onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>

            <div className="auth-row">
              <label className="auth-checkbox">
                <input type="checkbox" name="remember" /> Remember me
              </label>
              <Link href="/forgot-password" className="auth-link">Forgot password?</Link>
            </div>

            <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <div className="auth-divider">or</div>

          <button type="button" className="auth-btn" onClick={signInWithGoogle} disabled={googleLoading}>
            <GoogleIcon /> {googleLoading ? 'Redirecting…' : 'Sign in with Google'}
          </button>

          <p className="auth-foot">
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="auth-link" style={{ fontWeight: 600 }}>Sign up</Link>
          </p>
        </div>
      </div>

      <BrandPanel />
    </div>
  )
}

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  )
}
