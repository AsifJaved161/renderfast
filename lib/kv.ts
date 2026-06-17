// Cloudflare KV via REST API — pure fetch(), zero RAM overhead. Replaces Redis.

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID!
const NAMESPACE_ID = process.env.CLOUDFLARE_KV_NAMESPACE_ID!
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN!

const BASE = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${NAMESPACE_ID}`

function authHeaders(extra: Record<string, string> = {}) {
  return { Authorization: `Bearer ${API_TOKEN}`, ...extra }
}

// ── Key helpers ───────────────────────────────────────────────────────────────
async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function pageKey(domain: string, url: string): Promise<string> {
  return `${domain}:${await sha256(url)}`
}

// ── Compression (deflate-raw via Web Streams — no npm dependency) ─────────────
async function compress(text: string): Promise<Uint8Array> {
  const stream = new Response(text).body!.pipeThrough(
    new CompressionStream('deflate-raw')
  )
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompress(bytes: ArrayBuffer): Promise<string> {
  const stream = new Response(bytes).body!.pipeThrough(
    new DecompressionStream('deflate-raw')
  )
  return new Response(stream).text()
}

// ══════════════════════════════════════════════════════════════════════════════
// Cached pages
// ══════════════════════════════════════════════════════════════════════════════
export async function getCachedPage(domain: string, url: string): Promise<string | null> {
  const key = await pageKey(domain, url)
  const res = await fetch(`${BASE}/values/${encodeURIComponent(key)}`, {
    headers: authHeaders(),
  })
  if (!res.ok) return null
  try {
    return await decompress(await res.arrayBuffer())
  } catch {
    return null
  }
}

export async function setCachedPage(
  domain: string,
  url: string,
  html: string,
  ttlSeconds: number
): Promise<boolean> {
  const key = await pageKey(domain, url)
  const compressed = await compress(html)
  const res = await fetch(
    `${BASE}/values/${encodeURIComponent(key)}?expiration_ttl=${ttlSeconds}`,
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'application/octet-stream' }),
      // TS 5.8 types Uint8Array as Uint8Array<ArrayBufferLike>, which the fetch
      // BodyInit overloads reject directly; the bytes are a valid runtime body.
      body: compressed as unknown as BodyInit,
    }
  )
  return res.ok
}

export async function deleteCachedPage(domain: string, url: string): Promise<boolean> {
  const key = await pageKey(domain, url)
  const res = await fetch(`${BASE}/values/${encodeURIComponent(key)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return res.ok
}

export async function getCachedPagesList(domain: string): Promise<string[]> {
  const keys: string[] = []
  let cursor = ''
  do {
    const url = new URL(`${BASE}/keys`)
    url.searchParams.set('prefix', `${domain}:`)
    if (cursor) url.searchParams.set('cursor', cursor)
    const res = await fetch(url.toString(), { headers: authHeaders() })
    if (!res.ok) break
    const data = await res.json()
    for (const k of data.result ?? []) keys.push(k.name)
    cursor = data.result_info?.cursor ?? ''
  } while (cursor)
  return keys
}

export async function clearDomainCache(domain: string): Promise<number> {
  const keys = await getCachedPagesList(domain)
  if (keys.length === 0) return 0
  // Bulk delete — max 10k keys per request
  for (let i = 0; i < keys.length; i += 10000) {
    const batch = keys.slice(i, i + 10000)
    await fetch(`${BASE}/bulk/delete`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(batch),
    })
  }
  return keys.length
}

// ══════════════════════════════════════════════════════════════════════════════
// Rate limiting
// ══════════════════════════════════════════════════════════════════════════════
export async function getRateLimitCount(apiKey: string): Promise<number> {
  const res = await fetch(`${BASE}/values/ratelimit:${encodeURIComponent(apiKey)}`, {
    headers: authHeaders(),
  })
  if (!res.ok) return 0
  return parseInt(await res.text(), 10) || 0
}

export async function incrementRateLimit(
  apiKey: string,
  windowSeconds: number
): Promise<number> {
  const next = (await getRateLimitCount(apiKey)) + 1
  await fetch(
    `${BASE}/values/ratelimit:${encodeURIComponent(apiKey)}?expiration_ttl=${windowSeconds}`,
    {
      method: 'PUT',
      headers: authHeaders({ 'Content-Type': 'text/plain' }),
      body: String(next),
    }
  )
  return next
}
