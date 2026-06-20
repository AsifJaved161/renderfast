// ─────────────────────────────────────────────────────────────────────────────
// URL hygiene for the render pipeline — two efficiency levers:
//   • normalizeUrl()    — strip tracking params so /p and /p?utm=… share ONE
//                         cache entry (fewer renders, higher hit rate).
//   • isRenderableUrl() — skip low-value URLs (search, admin, api, feeds, cart)
//                         so we never spend a render on them.
// ─────────────────────────────────────────────────────────────────────────────

// Analytics/tracking params that never change page content.
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id', 'utm_name', 'utm_reader',
  'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'wbraid', 'gbraid', 'yclid', 'twclid',
  'mc_cid', 'mc_eid', '_ga', '_gl', 'igshid', 'si', 'ref', 'ref_src', 'ref_url', 'source',
  'spm', 'scm', 'vero_id', 'vero_conv', 'oly_anon_id', 'oly_enc_id', 'hsa_cam', 'hsa_grp',
  'amp', 'noamp', // AMP variants → fold into the canonical page
])

// Strip tracking params + hash, sort remaining params for a stable cache key.
export function normalizeUrl(input: string): string {
  try {
    const u = new URL(input)
    u.hash = ''
    const keep: [string, string][] = []
    u.searchParams.forEach((v, k) => {
      if (!TRACKING_PARAMS.has(k.toLowerCase())) keep.push([k, v])
    })
    keep.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    u.search = ''
    for (const [k, v] of keep) u.searchParams.append(k, v)
    // Drop a lone trailing "?" that URL can leave behind.
    return u.toString().replace(/\?$/, '')
  } catch {
    return input
  }
}

// Path segments that are never SEO content worth pre-rendering (incl. all
// WordPress assets: /wp-content/ images/css/js, /wp-includes/).
const SKIP_PATH = /\/(wp-admin|wp-json|wp-login|wp-content|wp-includes|xmlrpc\.php|cgi-bin|feed|comments\/feed|cart|checkout|my-account|wishlist)(\/|$|\.)/i
const SKIP_API = /^\/api(\/|$)/i
// Non-HTML resources / config & source files that must never be in SEO diagnostics.
const SKIP_EXT = /\.(env|json|xml|txt|js|mjs|cjs|css|map|ico|png|jpe?g|gif|svg|webp|avif|woff2?|ttf|eot|pdf|zip|gz|rar|lock|ya?ml|toml|ini|sh|bash|py|rb|php|sql|md|log|bak|old|example|sample|dist|conf|cfg)$/i
// Query keys whose presence marks a non-content page (WP search, cart actions…).
const SKIP_QUERY = ['s', 'add-to-cart', 'remove_item', 'replytocom', 'feed', 'sidebar', 'elementor-preview', 'preview', 'attachment_id']

export function isRenderableUrl(input: string): boolean {
  try {
    const u = new URL(input)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    // An encoded "?" (%3F) can hide a query inside the path (e.g. image.jpg%3Fver=1)
    // — ignore everything after it so the extension/dotfile checks still match.
    const path = u.pathname.split(/%3f/i)[0]
    if (SKIP_API.test(path)) return false
    if (SKIP_PATH.test(path)) return false
    if (SKIP_EXT.test(path)) return false // .env, .json, .xml, scripts, images…
    const lastSeg = path.split('/').pop() ?? ''
    if (lastSeg.startsWith('.')) return false // dotfiles: /.env, /.env.example, /.git/…
    for (const key of SKIP_QUERY) if (u.searchParams.has(key)) return false
    return true
  } catch {
    return false
  }
}
