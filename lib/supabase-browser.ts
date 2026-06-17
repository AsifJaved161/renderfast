'use client'

import { createClient } from '@supabase/supabase-js'

// Singleton browser client — used for client-side auth.
let client: ReturnType<typeof createClient> | null = null

export function getSupabaseBrowser() {
  if (!client) {
    client = createClient(
      (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
      (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim()
    )
  }
  return client
}
