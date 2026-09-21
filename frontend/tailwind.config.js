/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#07080d',
        surface: {
          DEFAULT: '#0f1119',
          raised: '#141726',
          hover: '#1a1e30',
        },
        edge: {
          DEFAULT: '#222738',
          strong: '#2e3448',
        },
        ink: {
          DEFAULT: '#e8eaf3',
          muted: '#9aa0b8',
          faint: '#6b7290',
        },
        brand: {
          50: '#eef2ff',
          400: '#818cf8',
          500: '#6366f1',
          600: '#5b54e8',
          700: '#4c46cf',
        },
        accent: {
          400: '#c084fc',
          500: '#a855f7',
        },
        state: {
          success: '#22c55e',
          warn: '#f59e0b',
          danger: '#ef4444',
          info: '#38bdf8',
          idle: '#64748b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.4), 0 8px 24px -12px rgba(0,0,0,0.6)',
        glow: '0 0 0 1px rgba(99,102,241,0.25), 0 12px 40px -12px rgba(99,102,241,0.45)',
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)',
        'surface-gradient': 'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(34,197,94,0.5)' },
          '70%': { boxShadow: '0 0 0 8px rgba(34,197,94,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(34,197,94,0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
        shimmer: 'shimmer 1.8s linear infinite',
        'pulse-ring': 'pulse-ring 2s ease-out infinite',
      },
    },
  },
  plugins: [],
};
