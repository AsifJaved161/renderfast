// Apply a path/URL search filter to a Supabase query, supporting `*` wildcards
// and `-term` exclusions (space-separated terms are AND-ed). Mirrors the filter
// syntax users expect from the competitor's console. Generic over the builder so
// it works on any column without pulling Supabase types in here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyUrlSearch<T extends { ilike: (...a: any[]) => T; not: (...a: any[]) => T }>(
  query: T,
  column: string,
  q: string | null | undefined
): T {
  if (!q) return query
  for (const raw of q.trim().split(/\s+/)) {
    if (!raw) continue
    const exclude = raw.startsWith('-')
    const body = (exclude ? raw.slice(1) : raw).replace(/%/g, '').replace(/\*/g, '%')
    if (!body) continue
    const pattern = body.includes('%') ? body : `%${body}%`
    query = exclude ? query.not(column, 'ilike', pattern) : query.ilike(column, pattern)
  }
  return query
}
