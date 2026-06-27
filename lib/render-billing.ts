// Single, atomic place to bill a render against a user's (and optionally a
// site's) render_count. Uses the increment_render_counts RPC (migration 023) so
// concurrent renders can't lose updates. Swallows all errors: billing must never
// break a served response, and pre-migration (RPC absent) it simply no-ops.
import { supabaseAdmin } from '@/lib/supabase'

export async function incrementRenderCounts(
  userId: string,
  siteId: string | null,
  n = 1
): Promise<void> {
  if (n <= 0) return
  try {
    await supabaseAdmin.rpc('increment_render_counts', {
      p_user: userId,
      p_site: siteId,
      p_n: n,
    })
  } catch {
    /* never throw into the request/render path */
  }
}
