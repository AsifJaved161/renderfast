/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  transpilePackages: ['antd', '@ant-design/icons'],

  // Strip console.* from production bundles (keep errors for debugging) — smaller
  // JS, no dev noise. Dev keeps everything.
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error'] } : false,
  },

  experimental: {
    // Import only the components/icons actually used from these big libraries →
    // a big "reduce unused JavaScript" win, with no code changes. (Official Next.)
    optimizePackageImports: ['antd', '@ant-design/icons', 'lucide-react'],
  },

  images: {
    remotePatterns: [{ protocol: 'https', hostname: '*.supabase.co' }],
  },
}

module.exports = nextConfig
