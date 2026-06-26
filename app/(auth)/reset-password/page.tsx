'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { getSupabaseBrowser } from '@/lib/supabase-browser'

// Step 2 of password recovery: the user arrives from the email link carrying a
// recovery session (PKCE ?code= or a recovery token in the URL hash). We
// establish that session, then let them set a new password via updateUser.
export default function ResetPasswordPage() {
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'ready' | 'invalid'>('checking')
  const [loading, setLoading] = useState(false)
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const supabase = getSupabaseBrowser()
    let cancelled = false

    ;(async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        if (!cancelled) setStatus('ready')
        return
      }
      const code = new URLSearchParams(window.location.search).get('code')
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!cancelled) setStatus(error ? 'invalid' : 'ready')
        return
      }
      // No session/code yet — give detectSessionInUrl (hash flow) a moment to fire.
      setTimeout(() => {
        if (!cancelled) setStatus((s) => (s === 'checking' ? 'invalid' : s))
      }, 1500)
    })()

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session && !cancelled) setStatus('ready')
    })
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const password = String(form.get('password') ?? '')
    const confirm = String(form.get('confirm') ?? '')
    setError(null)
    if (password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setLoading(true)
    try {
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) {
        setError(error.message)
        return
      }
      setDone(true)
      setTimeout(() => {
        router.push('/dashboard')
        router.refresh()
      }, 1200)
    } catch {
      setError('Network error — please try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-form-col">
        <div className="auth-form-inner">
          <h1 className="auth-h1">Set a new password</h1>
          <p className="auth-sub">Choose a strong password for your RenderForAI account.</p>

          {status === 'checking' && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <span
                style={{
                  width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#2da01d',
                  borderRadius: '50%', display: 'inline-block', animation: 'rf-spin 0.8s linear infinite',
                }}
              />
              <style>{`@keyframes rf-spin { to { transform: rotate(360deg) } }`}</style>
            </div>
          )}

          {status === 'invalid' && (
            <>
              <div className="auth-error">This reset link is invalid or has expired. Request a new one.</div>
              <p className="auth-foot">
                <Link href="/forgot-password" className="auth-link">Request a new reset link</Link>
              </p>
            </>
          )}

          {status === 'ready' && (
            done ? (
              <div className="auth-success">Password updated — signing you in…</div>
            ) : (
              <>
                {error && <div className="auth-error" role="alert">{error}</div>}
                <form onSubmit={onSubmit}>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="password">New password</label>
                    <div className="auth-input-wrap">
                      <input id="password" name="password" type={showPw ? 'text' : 'password'} required
                        minLength={8} autoComplete="new-password" className="auth-input" placeholder="••••••••" />
                      <button type="button" className="auth-toggle" onClick={() => setShowPw((v) => !v)}
                        aria-label={showPw ? 'Hide password' : 'Show password'}>
                        {showPw ? 'Hide' : 'Show'}
                      </button>
                    </div>
                  </div>
                  <div className="auth-field">
                    <label className="auth-label" htmlFor="confirm">Confirm password</label>
                    <input id="confirm" name="confirm" type={showPw ? 'text' : 'password'} required
                      minLength={8} autoComplete="new-password" className="auth-input" placeholder="••••••••" />
                  </div>
                  <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
                    {loading ? 'Updating…' : 'Update password'}
                  </button>
                </form>
              </>
            )
          )}
        </div>
      </div>
    </div>
  )
}
