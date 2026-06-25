'use client'

import { createBrowserClient } from '@supabase/ssr'

// Singleton browser client — uses @supabase/ssr so PKCE verifier is stored
// in cookies (readable by the server-side /api/auth/callback route handler).
let client: ReturnType<typeof createBrowserClient> | null = null

export function getSupabaseBrowser() {
  if (!client) {
    client = createBrowserClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
    )
  }
  return client
}
