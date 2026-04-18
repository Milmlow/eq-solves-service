/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // EQ brand tokens
        sky: {
          DEFAULT: '#3DA8D8',
          soft: '#EAF5FB',
          deep: '#2B7CA6',
        },
        ink: '#1A1A2E',
        paper: '#FFFFFF',
        // Utility
        ok: '#2E7D32',
        warn: '#E6A700',
        bad: '#C03232',
        border: '#D5E6EF',
        muted: '#6B7280',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(26, 26, 46, 0.05), 0 2px 8px rgba(26, 26, 46, 0.04)',
      },
      borderRadius: {
        xl: '12px',
      },
    },
  },
  plugins: [],
}
