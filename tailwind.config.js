/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // ─── EQ brand tokens (EQ Design Brief v1.3) ────────────────
        sky: {
          DEFAULT: '#3DA8D8',   // EQ Sky Blue — primary
          soft:    '#EAF5FB',   // EQ Ice Blue — background tint
          deep:    '#2986B4',   // EQ Deep Blue — hover (was #2B7CA6)
        },
        ink:   '#1A1A2E',       // EQ Ink — body text
        paper: '#FFFFFF',

        // ─── Status (aligned to brand spec — matches Service + Field) ──
        ok:   '#16A34A',        // was #2E7D32
        warn: '#D97706',        // was #E6A700
        bad:  '#DC2626',        // was #C03232

        // ─── Neutrals (aligned to Tailwind scale — spec default) ───
        border: '#E5E7EB',      // was #D5E6EF — neutral grey, not blue-tinted
        muted:  '#666666',      // EQ Mid Grey (was #6B7280)
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
