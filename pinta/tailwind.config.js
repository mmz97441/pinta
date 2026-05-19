/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        canvas:    'var(--bg-canvas)',
        surface:   'var(--bg-surface)',
        elevated:  'var(--bg-elevated)',
        primary:   'var(--text-primary)',
        secondary: 'var(--text-secondary)',
        muted:     'var(--text-muted)',
        navy:      'var(--brand-navy)',
        'navy-l':  'var(--brand-navy-l)',
        'navy-d':  'var(--brand-navy-d)',
        gold:      'var(--brand-gold)',
        'gold-l':  'var(--brand-gold-l)',
        'gold-d':  'var(--brand-gold-d)',
        success:   'var(--success)',
        warning:   'var(--warning)',
        danger:    'var(--danger)',
        info:      'var(--info)',
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
