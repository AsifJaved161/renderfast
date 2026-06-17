import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Prerender.io brand green (#2DA01D extracted from reference)
        brand: {
          50: '#e8fae5',
          100: '#ccf5c7',
          500: '#3cd827',
          600: '#2da01d',
          700: '#248217',
        },
      },
    },
  },
  plugins: [],
}

export default config
