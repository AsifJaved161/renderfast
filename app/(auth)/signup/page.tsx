'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { clearUserClientState } from '@/lib/client-session'
import BrandPanel from '../BrandPanel'

// 0–4 strength score → label + colour + bar width.
function passwordStrength(pw: string) {
  let score = 0
  if (pw.length >= 8) score++
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++
  if (/\d/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  const map = [
    { width: '0%', label: '', color: '#f0f0f0' },
    { width: '25%', label: 'Weak', color: '#ff4d4f' },
    { width: '50%', label: 'Fair', color: '#faad14' },
    { width: '75%', label: 'Good', color: '#52c41a' },
    { width: '100%', label: 'Strong', color: '#2da01d' },
  ]
  return map[score]
}

export default function SignupPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)

  const strength = passwordStrength(pw)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const full_name = String(form.get('full_name') ?? '')
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    setError(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ full_name, email, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Signup failed')
        return
      }
      clearUserClientState() // start the new account with a clean cache
      router.push('/dashboard')
      router.refresh()
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  async function signUpWithGoogle() {
    setGoogleLoading(true)
    clearUserClientState()
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
          <h1 className="auth-h1">Create your account</h1>
          <p className="auth-sub">Start prerendering your site for search &amp; AI bots</p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          <form onSubmit={onSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="full_name">Full name</label>
              <input id="full_name" name="full_name" type="text" required autoComplete="name"
                className="auth-input" placeholder="Jane Doe" />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="email">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email"
                className="auth-input" placeholder="you@example.com" />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="password">Password</label>
              <div className="auth-input-wrap">
                <input id="password" name="password" type={showPw ? 'text' : 'password'} required
                  minLength={8} autoComplete="new-password" className="auth-input" placeholder="••••••••"
                  value={pw} onChange={(e) => setPw(e.target.value)} />
                <button type="button" className="auth-toggle" onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}>
                  {showPw ? 'Hide' : 'Show'}
                </button>
              </div>
              {pw && (
                <>
                  <div className="auth-meter">
                    <div className="auth-meter-fill" style={{ width: strength.width, background: strength.color }} />
                  </div>
                  <span style={{ fontSize: 12, color: strength.color }}>{strength.label}</span>
                </>
              )}
            </div>

            <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
              {loading ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <div className="auth-divider">or</div>

          <button type="button" className="auth-btn" onClick={signUpWithGoogle} disabled={googleLoading}>
            <GoogleIcon /> {googleLoading ? 'Redirecting…' : 'Sign up with Google'}
          </button>

          <p className="auth-foot">
            Already have an account?{' '}
            <Link href="/login" className="auth-link" style={{ fontWeight: 600 }}>Sign in</Link>
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
