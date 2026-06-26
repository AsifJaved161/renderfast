// Server component (no 'use client') → ships zero JS. Inline SVGs avoid pulling
// an icon library onto these public pages.
const FEATURES = [
  { icon: '⚡', text: 'Lightning-fast prerendering' },
  { icon: '🤖', text: 'AI bot support (GPTBot, ClaudeBot, Perplexity)' },
  { icon: '🧩', text: 'One-click WordPress plugin' },
]

export default function BrandPanel() {
  return (
    <div className="auth-brand-col">
      <div className="auth-brand-logo">
        Render<span style={{ color: '#2da01d' }}>ForAI</span>
      </div>
      <h2 className="auth-brand-h2">Make your SPA visible to every search engine</h2>
      <div>
        {FEATURES.map((f) => (
          <div key={f.text} className="auth-feature">
            <span className="auth-feature-icon">{f.icon}</span>
            <span>{f.text}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
