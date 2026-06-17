import { Zap } from 'lucide-react'

// Dark "Render" stays legible on the white header; "Fast" uses the brand green.
export default function Logo({ light = false }: { light?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 800, fontSize: 18 }}>
      <Zap size={18} color="#2da01d" fill="#2da01d" />
      <span style={{ color: light ? '#ffffff' : '#1a1a2e' }}>Render</span>
      <span style={{ color: '#2da01d', marginLeft: -4 }}>Fast</span>
    </span>
  )
}
