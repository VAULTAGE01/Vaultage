/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{js,jsx,ts,tsx,html}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'monospace'],
      },
      colors: {
        // ── Vaultage app tokens (1Password style) ─────────────────────────
        bg:             '#020806',
        sidebar:        '#06100d',
        surface:        '#0d1714',
        card:           '#13231d',
        'card-hover':   '#1a2d25',
        border:         '#22342d',
        'border-light': '#365047',
        accent:         '#00FF7F',
        'accent-dim':   '#00cc62',
        'accent-hover': '#34d399',
        'accent-glow':  'rgba(0,255,127,0.16)',
        text:           '#f5f5f5',
        'text-secondary': '#a0a0a0',
        muted:          '#7a7a7a',
        'muted-light':  '#a8a8a8',
        subtle:         '#505050',
        danger:         '#ff453a',
        'danger-dim':   '#ff3021',
        warning:        '#ffd60a',
        info:           '#0A84FF',

        // ── shadcn CSS-variable tokens ─────────────────────────────────────
        background:  'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        input:  'hsl(var(--input))',
        ring:   'hsl(var(--ring))',
      },
      boxShadow: {
        'glow-accent': '0 0 20px rgba(0,255,127,0.16), 0 0 40px rgba(0,255,127,0.07)',
        'glow-sm':     '0 0 10px rgba(0,255,127,0.14)',
        'card':        '0 1px 3px rgba(0,0,0,0.35), 0 12px 36px rgba(0,0,0,0.24)',
        'modal':       '0 18px 70px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.45)',
        'inner-top':   'inset 0 1px 0 rgba(255,255,255,0.05)',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
      },
      animation: {
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-up':   'slideUp 0.25s cubic-bezier(0.16,1,0.3,1)',
        'slide-down': 'slideDown 0.25s cubic-bezier(0.16,1,0.3,1)',
        'scale-in':   'scaleIn 0.2s cubic-bezier(0.16,1,0.3,1)',
        'dialog-scale-in': 'dialogScaleIn 0.2s cubic-bezier(0.16,1,0.3,1)',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4,0,0.6,1) infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' },                          to: { opacity: '1' } },
        slideUp:   { from: { opacity: '0', transform: 'translateY(8px)' },  to: { opacity: '1', transform: 'translateY(0)' } },
        slideDown: { from: { opacity: '0', transform: 'translateY(-6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        scaleIn:   { from: { opacity: '0', transform: 'scale(0.95)' },      to: { opacity: '1', transform: 'scale(1)' } },
        dialogScaleIn: {
          from: { opacity: '0', transform: 'translate(-50%, -50%) scale(0.96)' },
          to:   { opacity: '1', transform: 'translate(-50%, -50%) scale(1)' },
        },
      },
      borderRadius: {
        lg:  'var(--radius)',
        md:  'calc(var(--radius) - 2px)',
        sm:  'calc(var(--radius) - 4px)',
        '4xl': '2rem',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
    }
  },
  plugins: [],
}
