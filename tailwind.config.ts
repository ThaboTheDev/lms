import type { Config } from 'tailwindcss';

// Institutional design system. Colours are driven by CSS custom properties so
// that each tenant can re-brand the platform at runtime (see globals.css and
// the institution branding settings).
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--ink) / <alpha-value>)',
        muted: 'rgb(var(--muted) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        caution: 'rgb(var(--caution) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        serif: ['var(--font-serif)', 'Georgia', 'serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      maxWidth: { prose: '72ch' },
      borderRadius: { sm: '2px', DEFAULT: '3px', md: '4px', lg: '6px' },
    },
  },
  plugins: [],
} satisfies Config;
