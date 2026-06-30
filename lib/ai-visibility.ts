// ─────────────────────────────────────────────────────────────────────────────
// AI Visibility Tracker — query AI answer engines with a client's tracked prompts
// and detect whether their brand/domain is mentioned or cited in the answer.
//
// Engines: ChatGPT (OpenAI), Gemini (Google), Claude (Anthropic), Grok (xAI),
// Perplexity (Sonar). Each engine accepts a LIST of API keys (primary + failover)
// and is retried on the next key when one is exhausted (quota / rate-limit / auth).
//
// All engines are called over raw HTTP for a uniform multi-provider surface; the
// model IDs live in ENGINE_MODELS below so they're easy to update.
// ─────────────────────────────────────────────────────────────────────────────
import type { AiEngine } from '@/lib/app-config'

export interface EngineResult {
  engine: AiEngine
  mentioned: boolean
  citationUrl: string | null
  snippet: string | null
  error: string | null
}

// Model per engine — bump these as providers ship newer models.
export const ENGINE_MODELS: Record<AiEngine, string> = {
  chatgpt: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  claude: 'claude-haiku-4-5',
  grok: 'grok-2-latest',
  perplexity: 'sonar',
}

export const ENGINE_LABELS: Record<AiEngine, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  claude: 'Claude',
  grok: 'Grok',
  perplexity: 'Perplexity',
}

// A raw answer from one engine call, before brand/citation evaluation.
interface RawAnswer {
  text: string
  citations: string[]
  error?: string
  // exhausted = this key hit its quota / rate limit / auth failure → try the
  // next key for this engine.
  exhausted?: boolean
}

const URL_RE = /https?:\/\/[^\s)>\]]+/gi

export function normalizeDomain(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
}

function snippetAround(text: string, idx: number): string {
  const start = Math.max(0, idx - 80)
  const end = Math.min(text.length, idx + 120)
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = '…' + s
  if (end < text.length) s = s + '…'
  return s
}

function mentionIndex(text: string, brand: string, domain: string): number {
  const lc = text.toLowerCase()
  const b = brand.trim().toLowerCase()
  if (b && b.length >= 2) {
    const i = lc.indexOf(b)
    if (i >= 0) return i
  }
  if (domain) {
    const i = lc.indexOf(domain)
    if (i >= 0) return i
  }
  return -1
}

// Given answer text + any engine-provided citation URLs, decide mention + proof.
function evaluate(engine: AiEngine, raw: RawAnswer, brand: string, domain: string): EngineResult {
  if (raw.error && !raw.text) {
    return { engine, mentioned: false, citationUrl: null, snippet: null, error: raw.error }
  }
  const text = raw.text
  const idx = mentionIndex(text, brand, domain)
  const b = brand.trim().toLowerCase()

  const citedUrl = raw.citations.find((u) => domain && u.toLowerCase().includes(domain)) ?? null
  const textUrl = (text.match(URL_RE) ?? []).find((u) => domain && u.toLowerCase().includes(domain)) ?? null

  const mentioned = idx >= 0 || !!citedUrl
  let snippet: string | null = null
  if (idx >= 0) snippet = snippetAround(text, idx)
  else if (citedUrl) {
    const bi = b ? text.toLowerCase().indexOf(b) : -1
    snippet = bi >= 0 ? snippetAround(text, bi) : snippetAround(text, 0)
  }

  return {
    engine,
    mentioned,
    citationUrl: citedUrl ?? textUrl ?? null,
    snippet,
    error: raw.error ?? null,
  }
}

// Map an HTTP status to whether we should fail over to the next key.
function isExhausted(status: number): boolean {
  return status === 429 || status === 401 || status === 403 || status === 402
}

// ── Per-engine fetchers — (prompt, key) → RawAnswer ───────────────────────────
type Fetcher = (prompt: string, key: string) => Promise<RawAnswer>

const askOpenAI: Fetcher = async (prompt, key) => {
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ENGINE_MODELS.chatgpt,
        temperature: 0.2,
        messages: [
          { role: 'system', content: 'You recommend real tools, products and resources. Answer concisely and name specific brands/products with links where you can.' },
          { role: 'user', content: prompt },
        ],
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: '', citations: [], error: `OpenAI ${res.status}: ${t.slice(0, 120)}`, exhausted: isExhausted(res.status) }
    }
    const data = await res.json()
    return { text: data?.choices?.[0]?.message?.content ?? '', citations: [] }
  } catch (e) {
    return { text: '', citations: [], error: (e as Error).message }
  }
}

const askGemini: Fetcher = async (prompt, key) => {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${ENGINE_MODELS.gemini}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      }
    )
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: '', citations: [], error: `Gemini ${res.status}: ${t.slice(0, 120)}`, exhausted: isExhausted(res.status) }
    }
    const data = await res.json()
    const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? []
    return { text: parts.map((p) => p.text ?? '').join(''), citations: [] }
  } catch (e) {
    return { text: '', citations: [], error: (e as Error).message }
  }
}

// Anthropic Messages API (raw HTTP — uniform with the other providers here).
const askClaude: Fetcher = async (prompt, key) => {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ENGINE_MODELS.claude,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: '', citations: [], error: `Claude ${res.status}: ${t.slice(0, 120)}`, exhausted: isExhausted(res.status) }
    }
    const data = await res.json()
    const blocks: { type?: string; text?: string }[] = data?.content ?? []
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('')
    return { text, citations: [] }
  } catch (e) {
    return { text: '', citations: [], error: (e as Error).message }
  }
}

// xAI Grok — OpenAI-compatible chat completions.
const askGrok: Fetcher = async (prompt, key) => {
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ENGINE_MODELS.grok,
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: '', citations: [], error: `Grok ${res.status}: ${t.slice(0, 120)}`, exhausted: isExhausted(res.status) }
    }
    const data = await res.json()
    const citations: string[] = Array.isArray(data?.citations)
      ? data.citations.filter((c: unknown): c is string => typeof c === 'string')
      : []
    return { text: data?.choices?.[0]?.message?.content ?? '', citations }
  } catch (e) {
    return { text: '', citations: [], error: (e as Error).message }
  }
}

const askPerplexity: Fetcher = async (prompt, key) => {
  try {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: ENGINE_MODELS.perplexity, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) {
      const t = await res.text().catch(() => '')
      return { text: '', citations: [], error: `Perplexity ${res.status}: ${t.slice(0, 120)}`, exhausted: isExhausted(res.status) }
    }
    const data = await res.json()
    const citations: string[] = Array.isArray(data?.citations)
      ? data.citations.filter((c: unknown): c is string => typeof c === 'string')
      : Array.isArray(data?.search_results)
        ? data.search_results.map((r: { url?: string }) => r?.url).filter((u: unknown): u is string => typeof u === 'string')
        : []
    return { text: data?.choices?.[0]?.message?.content ?? '', citations }
  } catch (e) {
    return { text: '', citations: [], error: (e as Error).message }
  }
}

const FETCHERS: Record<AiEngine, Fetcher> = {
  chatgpt: askOpenAI,
  gemini: askGemini,
  claude: askClaude,
  grok: askGrok,
  perplexity: askPerplexity,
}

// Call one engine, trying each key in turn until one succeeds or returns a
// hard (non-quota) error. Returns the raw answer.
async function callWithFailover(engine: AiEngine, prompt: string, keys: string[]): Promise<RawAnswer> {
  let last: RawAnswer = { text: '', citations: [], error: 'No API key configured' }
  for (let i = 0; i < keys.length; i++) {
    const raw = await FETCHERS[engine](prompt, keys[i])
    last = raw
    if (raw.text || !raw.exhausted) return raw // answer, or hard error → stop
  }
  return last
}

// Run one engine for one prompt (with key failover) and evaluate the mention.
async function runEngine(engine: AiEngine, prompt: string, brand: string, domain: string, keys: string[]): Promise<EngineResult> {
  return evaluate(engine, await callWithFailover(engine, prompt, keys), brand, domain)
}

// Strip list markers / quotes from a generated line.
function cleanLine(s: string): string {
  return s
    .replace(/^\s*[-*•\d.)\]]+\s*/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}

// Auto-generate niche search queries a potential customer would ask an AI
// assistant when looking for this brand's type of product/service. Uses the
// first configured engine (with failover). Returns up to `count` prompts.
export async function generatePrompts(
  brand: string,
  domain: string,
  count: number,
  engines: Partial<Record<AiEngine, string[]>>
): Promise<string[]> {
  const active = (Object.entries(engines) as [AiEngine, string[]][]).filter(([, keys]) => keys && keys.length > 0)
  if (active.length === 0 || count <= 0) return []
  const [engine, keys] = active[0]
  const dom = normalizeDomain(domain)
  const instruction =
    `You are an SEO and AI-visibility researcher. A company's brand is "${brand}"` +
    (dom ? ` with the website ${dom}` : '') +
    `. Generate ${count} distinct, natural-language search queries that potential customers would ask an AI assistant (like ChatGPT or Perplexity) when looking for the type of product or service this company offers. ` +
    `Focus on the niche, problem, or use case — do NOT include the brand name in the queries. ` +
    `Return ONLY the queries, one per line, with no numbering, bullets, quotes, or extra commentary.`

  const raw = await callWithFailover(engine, instruction, keys)
  const lines = (raw.text || '')
    .split('\n')
    .map(cleanLine)
    .filter((l) => l.length >= 6 && !l.endsWith(':'))
  return [...new Set(lines)].slice(0, count)
}

// Check ONE prompt across every engine that has ≥1 key (in parallel).
export async function checkPrompt(
  prompt: string,
  brand: string,
  domain: string,
  engines: Partial<Record<AiEngine, string[]>>
): Promise<EngineResult[]> {
  const dom = normalizeDomain(domain)
  const active = (Object.entries(engines) as [AiEngine, string[]][]).filter(([, keys]) => keys && keys.length > 0)
  return Promise.all(active.map(([engine, keys]) => runEngine(engine, prompt, brand, dom, keys)))
}

// Bounded-concurrency map so a large scan doesn't fire every request at once.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
