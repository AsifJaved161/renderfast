'use client'

import { useState } from 'react'
import Link from 'next/link'

// Step 1 of password recovery: email a reset link that lands on /reset-password.
export default function ForgotPasswordPage() {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim()
    setError(null)
    setLoading(true)
    try {
      const { getSupabaseBrowser } = await import('@/lib/supabase-browser')
      const supabase = getSupabaseBrowser()
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      // Never reveal whether an email is registered (ignore non-rate-limit errors too).
      if (error && /rate limit/i.test(error.message)) {
        setError(error.message)
        return
      }
      setSent(true)
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
          <h1 className="auth-h1">Reset your password</h1>
          <p className="auth-sub">Enter your email and we&apos;ll send you a link to set a new password.</p>

          {error && <div className="auth-error" role="alert">{error}</div>}

          {sent ? (
            <div className="auth-success">
              If an account exists for that address, a password-reset link is on its way. The link
              expires after a short while.
            </div>
          ) : (
            <form onSubmit={onSubmit}>
              <div className="auth-field">
                <label className="auth-label" htmlFor="email">Email</label>
                <input id="email" name="email" type="email" required autoComplete="email"
                  className="auth-input" placeholder="you@example.com" />
              </div>
              <button type="submit" className="auth-btn auth-btn-primary" disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}

          <p className="auth-foot">
            <Link href="/login" className="auth-link">← Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
