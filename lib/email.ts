import { Resend } from 'resend'
import type { DbUser } from '@/lib/supabase'

// Lazily constructed so the build never instantiates Resend without an API key
// (its constructor throws on a missing key during `next build` page-data collection).
let _resend: Resend | null = null
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY)
  return _resend
}
const resend = new Proxy({} as Resend, {
  get(_target, prop) {
    const client = getResend()
    const value = Reflect.get(client as object, prop)
    return typeof value === 'function' ? value.bind(client) : value
  },
})
const FROM = 'RenderFast <noreply@renderfast.io>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? 'https://renderfast.io'
const BRAND = '#2da01d'

function emailOf(user: DbUser | { email: string } | string): string {
  return typeof user === 'string' ? user : user.email
}

// Shared HTML shell with green branding + unsubscribe footer.
function shell(title: string, body: string) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f5;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="font-size:24px;font-weight:800;color:#1a1a2e;margin-bottom:16px">
      Render<span style="color:${BRAND}">Fast</span>
    </div>
    <div style="background:#fff;border-radius:12px;padding:28px;border-top:4px solid ${BRAND}">
      <h1 style="font-size:20px;color:#111;margin-top:0">${title}</h1>
      ${body}
    </div>
    <p style="font-size:12px;color:#999;text-align:center;margin-top:20px">
      <a href="${APP_URL}/settings" style="color:#999">Manage email preferences</a> ·
      <a href="${APP_URL}/unsubscribe" style="color:#999">Unsubscribe</a>
    </p>
  </div></body></html>`
}

function button(href: string, label: string) {
  return `<a href="${href}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;margin-top:12px">${label}</a>`
}

async function send(to: string, subject: string, html: string) {
  if (!process.env.RESEND_API_KEY) return
  try {
    await resend.emails.send({ from: FROM, to, subject, html })
  } catch {
    // email failures must never break the calling flow
  }
}

// ── Team invite ──────────────────────────────────────────────────────────────
export async function sendTeamInviteEmail(toEmail: string, inviterName: string, role: string, token: string) {
  const html = shell(
    `You've been invited to a RenderFast team`,
    `<p><strong>${inviterName}</strong> invited you to join their RenderFast account as a
     <strong>${role}</strong>.</p>
     <p>Sign in (or sign up) with <strong>${toEmail}</strong>, then open your Team page to accept.</p>
     ${button(`${APP_URL}/team?invite=${token}`, 'Accept invitation')}
     <p style="font-size:12px;color:#999;margin-top:16px">If you weren't expecting this, you can ignore this email.</p>`
  )
  await send(toEmail, `${inviterName} invited you to their RenderFast team`, html)
}

// ── Welcome ────────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(user: DbUser) {
  const html = shell(
    'Welcome to RenderFast 🚀',
    `<p>Hi ${user.full_name ?? 'there'}, your account is ready.</p>
     <p><strong>Your API key:</strong></p>
     <pre style="background:#16213e;color:#e6e6e6;padding:12px;border-radius:8px;font-size:13px">${user.api_key ?? '—'}</pre>
     <p><strong>Getting started:</strong></p>
     <ol style="color:#444;line-height:1.7">
       <li>Add your domain in the dashboard</li>
       <li>Pick an integration (DNS, Middleware, or WordPress)</li>
       <li>Verify and watch the bots roll in</li>
     </ol>
     ${button(`${APP_URL}/integration-wizard`, 'Start the wizard')}`
  )
  await send(user.email, 'Welcome to RenderFast', html)
}

// ── Usage warning (80%) ──────────────────────────────────────────────────────
export async function sendUsageWarningEmail(user: DbUser, percent: number) {
  const html = shell(
    `You've used ${percent}% of your renders`,
    `<p>Hi ${user.full_name ?? 'there'}, you've used <strong>${percent}%</strong> of your monthly render quota
     (${user.render_count.toLocaleString()} / ${user.render_limit.toLocaleString()}).</p>
     <p>Upgrade now to avoid any interruption once you hit your limit.</p>
     ${button(`${APP_URL}/billing`, 'View plans')}`
  )
  await send(user.email, `You've used ${percent}% of your renders this month`, html)
}

// ── Usage limit hit (accepts a user or a bare email for webhook reuse) ───────
export async function sendUsageLimitEmail(
  user: DbUser | { email: string } | string,
  opts?: { reason?: string }
) {
  const html = shell(
    "You've hit your render limit",
    `<p>${opts?.reason ?? "You've reached your monthly render limit."} New render requests
     will be paused until your quota resets or you upgrade.</p>
     ${button(`${APP_URL}/billing`, 'Upgrade to continue')}`
  )
  await send(emailOf(user), 'You’ve hit your render limit — upgrade to continue', html)
}

// ── Account banned ───────────────────────────────────────────────────────────
export async function sendBanEmail(user: DbUser | { email: string } | string, reason?: string) {
  const html = shell(
    'Your RenderFast account has been suspended',
    `<p>Your account has been suspended${reason ? ` for the following reason:</p><p style="color:#b00">${reason}</p>` : '.</p>'}
     <p>If you believe this is a mistake, please reply to this email to appeal.</p>`
  )
  await send(emailOf(user), 'Your RenderFast account has been suspended', html)
}

// ── Render error alert ───────────────────────────────────────────────────────
export async function sendRenderErrorEmail(user: DbUser, url: string, error: string) {
  const html = shell(
    'Repeated render failures detected',
    `<p>Hi ${user.full_name ?? 'there'}, we hit repeated errors rendering:</p>
     <pre style="background:#16213e;color:#ff8a8a;padding:12px;border-radius:8px;font-size:13px">${url}</pre>
     <p style="color:#b00">${error}</p>
     ${button(`${APP_URL}/render-history`, 'View render history')}`
  )
  await send(user.email, 'RenderFast: repeated render failures', html)
}
