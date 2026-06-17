export type BotType = 'search' | 'ai' | 'social' | 'seo' | 'other'

export interface BotInfo {
  isBot: boolean
  botName: string | null
  botType: BotType | null
}

interface BotPattern {
  pattern: string
  name: string
  type: BotType
}

const BOT_PATTERNS: BotPattern[] = [
  // ── Search engines ─────────────────────────────────────────────────────────
  { pattern: 'googlebot',           name: 'Googlebot',        type: 'search' },
  { pattern: 'adsbot-google',       name: 'Google AdsBot',    type: 'search' },
  { pattern: 'mediapartners-google',name: 'Google Mediapartners', type: 'search' },
  { pattern: 'google-inspectiontool', name: 'Google Inspection', type: 'search' },
  { pattern: 'bingbot',             name: 'Bingbot',          type: 'search' },
  { pattern: 'msnbot',              name: 'MSNBot',           type: 'search' },
  { pattern: 'bingpreview',         name: 'Bing Preview',     type: 'search' },
  { pattern: 'adidxbot',            name: 'Bing AdIdx',       type: 'search' },
  { pattern: 'duckduckbot',         name: 'DuckDuckBot',      type: 'search' },
  { pattern: 'duckduckgo',          name: 'DuckDuckGo',       type: 'search' },
  { pattern: 'yandexbot',           name: 'YandexBot',        type: 'search' },
  { pattern: 'yandeximages',        name: 'YandexImages',     type: 'search' },
  { pattern: 'baiduspider',         name: 'Baiduspider',      type: 'search' },
  { pattern: 'sogou',               name: 'Sogou',            type: 'search' },
  { pattern: 'exabot',              name: 'Exabot',           type: 'search' },
  { pattern: 'ia_archiver',         name: 'Internet Archive', type: 'search' },
  { pattern: 'archive.org_bot',     name: 'Archive.org',      type: 'search' },
  { pattern: 'slurp',               name: 'Yahoo! Slurp',     type: 'search' },
  { pattern: 'teoma',               name: 'Teoma',            type: 'search' },
  { pattern: 'naver',               name: 'Naverbot',         type: 'search' },
  { pattern: 'seznam.cz',           name: 'Seznam',           type: 'search' },
  { pattern: 'qwantify',            name: 'Qwant',            type: 'search' },
  { pattern: 'petalbot',            name: 'PetalBot',         type: 'search' },

  // ── AI crawlers ────────────────────────────────────────────────────────────
  { pattern: 'gptbot',              name: 'GPTBot',           type: 'ai' },
  { pattern: 'chatgpt-user',        name: 'ChatGPT',          type: 'ai' },
  { pattern: 'oai-searchbot',       name: 'OpenAI SearchBot', type: 'ai' },
  { pattern: 'claudebot',           name: 'ClaudeBot',        type: 'ai' },
  { pattern: 'anthropic-ai',        name: 'Anthropic AI',     type: 'ai' },
  { pattern: 'claude-web',          name: 'Claude Web',       type: 'ai' },
  { pattern: 'perplexitybot',       name: 'PerplexityBot',    type: 'ai' },
  { pattern: 'cohere-ai',           name: 'Cohere AI',        type: 'ai' },
  { pattern: 'youbot',              name: 'YouBot',           type: 'ai' },
  { pattern: 'meta-externalagent',  name: 'Meta AI',          type: 'ai' },
  { pattern: 'bytespider',          name: 'ByteSpider',       type: 'ai' },
  { pattern: 'amazonbot',           name: 'AmazonBot',        type: 'ai' },
  { pattern: 'applebot',            name: 'Applebot',         type: 'ai' },

  // ── Social / preview bots ──────────────────────────────────────────────────
  { pattern: 'facebookexternalhit', name: 'Facebook',         type: 'social' },
  { pattern: 'facebot',             name: 'Facebook',         type: 'social' },
  { pattern: 'twitterbot',          name: 'Twitter/X',        type: 'social' },
  { pattern: 'linkedinbot',         name: 'LinkedIn',         type: 'social' },
  { pattern: 'slackbot',            name: 'Slack',            type: 'social' },
  { pattern: 'slack-imgproxy',      name: 'Slack Image',      type: 'social' },
  { pattern: 'discordbot',          name: 'Discord',          type: 'social' },
  { pattern: 'telegrambot',         name: 'Telegram',         type: 'social' },
  { pattern: 'whatsapp',            name: 'WhatsApp',         type: 'social' },
  { pattern: 'pinterest',           name: 'Pinterest',        type: 'social' },
  { pattern: 'tumblrbot',           name: 'Tumblr',           type: 'social' },
  { pattern: 'vkshare',             name: 'VK',               type: 'social' },
  { pattern: 'rogerbot',            name: 'Rogerbot',         type: 'social' },
  { pattern: 'embedly',             name: 'Embedly',          type: 'social' },
  { pattern: 'outbrain',            name: 'Outbrain',         type: 'social' },
  { pattern: 'flipboard',           name: 'Flipboard',        type: 'social' },
  { pattern: 'iframely',            name: 'Iframely',         type: 'social' },

  // ── SEO tools ──────────────────────────────────────────────────────────────
  { pattern: 'ahrefsbot',           name: 'Ahrefs',           type: 'seo' },
  { pattern: 'ahrefssiteaudit',     name: 'Ahrefs Audit',     type: 'seo' },
  { pattern: 'semrushbot',          name: 'SEMrush',          type: 'seo' },
  { pattern: 'mj12bot',             name: 'Majestic',         type: 'seo' },
  { pattern: 'dotbot',              name: 'Moz DotBot',       type: 'seo' },
  { pattern: 'rogerbot',            name: 'Moz Rogerbot',     type: 'seo' },
  { pattern: 'seokicks',            name: 'SEOkicks',         type: 'seo' },
  { pattern: 'seobilitybot',        name: 'SEObility',        type: 'seo' },
  { pattern: 'serpstatbot',         name: 'Serpstat',         type: 'seo' },
  { pattern: 'screaming frog',      name: 'Screaming Frog',   type: 'seo' },
  { pattern: 'sitebulb',            name: 'Sitebulb',         type: 'seo' },
  { pattern: 'netsystemsresearch',  name: 'Net Systems Research', type: 'seo' },

  // ── Other crawlers ─────────────────────────────────────────────────────────
  { pattern: 'uptimerobot',         name: 'UptimeRobot',      type: 'other' },
  { pattern: 'monitor.us',          name: 'Monitor.us',       type: 'other' },
  { pattern: 'w3c_validator',       name: 'W3C Validator',    type: 'other' },
  { pattern: 'w3c-checklink',       name: 'W3C CheckLink',    type: 'other' },
  { pattern: 'feedfetcher',         name: 'Feed Fetcher',     type: 'other' },
  { pattern: 'feedburner',          name: 'FeedBurner',       type: 'other' },
]

export function detectBot(userAgent: string | null | undefined): BotInfo {
  if (!userAgent) return { isBot: false, botName: null, botType: null }

  const ua = userAgent.toLowerCase()

  for (const { pattern, name, type } of BOT_PATTERNS) {
    if (ua.includes(pattern)) {
      return { isBot: true, botName: name, botType: type }
    }
  }

  return { isBot: false, botName: null, botType: null }
}

export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  return detectBot(userAgent).isBot
}
