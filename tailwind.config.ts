import type { Config } from 'tailwindcss';

// MSRI design system. Colours are driven by CSS custom properties so an
// institution can still re-point the structural tokens at runtime (see
// globals.css and institutionBrandStyle). The type stack is the institute's
// own: Candara / Calibri, not a downloaded face.
const sans = ['Candara', 'Calibri', 'Segoe UI', 'Optima', 'Arial', 'sans-serif'];

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
        navy: 'rgb(var(--navy) / <alpha-value>)',
        'navy-light': 'rgb(var(--navy-light) / <alpha-value>)',
        gold: 'rgb(var(--gold) / <alpha-value>)',
        'gold-bright': 'rgb(var(--gold-bright) / <alpha-value>)',
        'gold-ink': 'rgb(var(--gold-ink) / <alpha-value>)',
        brand: 'rgb(var(--brand) / <alpha-value>)',
        accent: 'rgb(var(--accent) / <alpha-value>)',
        caution: 'rgb(var(--caution) / <alpha-value>)',
        danger: 'rgb(var(--danger) / <alpha-value>)',
        'on-brand': 'rgb(var(--on-brand) / <alpha-value>)',
        'on-danger': 'rgb(var(--on-danger) / <alpha-value>)',
        rail: 'rgb(var(--rail) / <alpha-value>)',
        'rail-ink': 'rgb(var(--rail-ink) / <alpha-value>)',
        'rail-muted': 'rgb(var(--rail-muted) / <alpha-value>)',
        'rail-accent': 'rgb(var(--rail-accent) / <alpha-value>)',
      },
      fontFamily: {
        sans,
        serif: sans,
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      maxWidth: { prose: '72ch' },
      borderRadius: { sm: '4px', DEFAULT: '6px', md: '8px', lg: '12px' },
      boxShadow: {
        card: '0 4px 15px rgb(11 17 59 / 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
