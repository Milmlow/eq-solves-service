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
          deep:    '#2986B4',   // EQ Deep Blue — hover
        },
        ice:   '#EAF5FB',       // explicit eq-ice token
        ink:   '#1A1A2E',       // EQ Ink — body text
        paper: '#FFFFFF',

        // ─── Status (aligned Tailwind-spec trio) ────────────────────
        ok:   '#16A34A',
        warn: '#D97706',
        bad:  '#DC2626',

        // Full status tone pairs (for Pill / toast backgrounds)
        'ok-bg':   '#F0FDF4',
        'ok-fg':   '#15803D',
        'warn-bg': '#FFFBEB',
        'warn-fg': '#B45309',
        'bad-bg':  '#FEF2F2',
        'bad-fg':  '#B91C1C',

        // ─── Neutrals (Tailwind scale — matches spec) ──────────────
        border: '#E5E7EB',
        muted:  '#666666',      // EQ Mid Grey
        grey:   '#666666',      // alias
        gray: {
          50:  '#F9FAFB',
          100: '#F3F4F6',
          200: '#E5E7EB',
          300: '#D1D5DB',
          400: '#9CA3AF',
          500: '#6B7280',
          600: '#4B5563',
        },
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        // EQ type scale
        xs:   ['11px', { lineHeight: '1.4' }],
        sm:   ['12px', { lineHeight: '1.5' }],
        base: ['14px', { lineHeight: '1.5' }],
        md:   ['15px', { lineHeight: '1.5' }],
        lg:   ['18px', { lineHeight: '1.3' }],
        xl:   ['22px', { lineHeight: '1.25' }],
        '2xl':['28px', { lineHeight: '1.2'  }],
        '3xl':['36px', { lineHeight: '1.15' }],
        '4xl':['48px', { lineHeight: '1.05' }],
      },
      boxShadow: {
        xs:   '0 1px 2px rgba(0,0,0,0.05)',
        sm:   '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        lg:   '0 10px 40px rgba(0,0,0,0.15)',
        card: '0 1px 2px rgba(26, 26, 46, 0.05), 0 2px 8px rgba(26, 26, 46, 0.04)',
        focus: '0 0 0 3px rgba(61, 168, 216, 0.20)',
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '8px',
        xl: '12px',
      },
      letterSpacing: {
        eyebrow: '0.2em',
        label:   '0.06em',
        pill:    '0.05em',
      },
    },
  },
  plugins: [],
}
