/** @type {import('tailwindcss').Config} */
export default {
    darkMode: 'class',
    content: [
      "./index.html",
      "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
      screens: {
        'xs': '320px',
        'sm': '480px',
        'md': '768px',
        'lg': '1024px',
        'xl': '1280px',
        '2xl': '1440px',
        '3xl': '1920px',
      },
      extend: {
        colors: {
          // Light mode
          light: {
            bg: {
              primary: '#ffffff',
              secondary: '#f8f9fa',
              tertiary: '#f0f2f5',
            },
            text: {
              primary: '#1a1a1a',
              secondary: '#6b7280',
              tertiary: '#9ca3af',
            },
          },
          // Dark mode
          dark: {
            bg: {
              primary: '#0f172a',
              secondary: '#1e293b',
              tertiary: '#334155',
            },
            text: {
              primary: '#f1f5f9',
              secondary: '#cbd5e1',
              tertiary: '#94a3b8',
            },
          },
          // Legacy colors (for compatibility)
          primary: "#1e1e24",
          secondary: "#2a2a35", 
          accent: "#4f46e5",
          // Theme tokens
          theme: {
            primary: 'rgb(79 70 229 / <alpha-value>)', // indigo-500
            accent: 'rgb(59 130 246 / <alpha-value>)', // blue-500
            success: 'rgb(34 197 94 / <alpha-value>)', // green-500
            warning: 'rgb(245 158 11 / <alpha-value>)', // amber-500
            error: 'rgb(239 68 68 / <alpha-value>)', // red-500
          },
        },
        spacing: {
          'touch': '44px', // Touch target minimum size (WCAG 2.1)
          'safe-top': 'env(safe-area-inset-top)',
          'safe-bottom': 'env(safe-area-inset-bottom)',
          'safe-left': 'env(safe-area-inset-left)',
          'safe-right': 'env(safe-area-inset-right)',
        },
        keyframes: {
          fadeIn: {
            '0%': { opacity: '0', transform: 'translateY(4px)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
          slideInUp: {
            '0%': { opacity: '0', transform: 'translateY(16px)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
          slideInDown: {
            '0%': { opacity: '0', transform: 'translateY(-16px)' },
            '100%': { opacity: '1', transform: 'translateY(0)' },
          },
          shimmer: {
            '0%': { backgroundPosition: '-1000px 0' },
            '100%': { backgroundPosition: '1000px 0' },
          },
        },
        animation: {
          fadeIn: 'fadeIn 0.3s ease-out both',
          slideInUp: 'slideInUp 0.3s ease-out both',
          slideInDown: 'slideInDown 0.3s ease-out both',
          shimmer: 'shimmer 2s infinite linear',
        },
        minHeight: {
          touch: '44px',
          screen: '100vh',
          screen_safe: 'max(100vh, 100vh + env(safe-area-inset-bottom))',
        },
        minWidth: {
          touch: '44px',
        },
        transitionDuration: {
          250: '250ms',
        },
      },
    },
    plugins: [
      function ({ addComponents, theme }) {
        addComponents({
          '.touch-target': {
            minHeight: theme('spacing.touch'),
            minWidth: theme('spacing.touch'),
          },
          '.safe-area-padding': {
            paddingTop: theme('spacing.safe-top'),
            paddingBottom: theme('spacing.safe-bottom'),
            paddingLeft: theme('spacing.safe-left'),
            paddingRight: theme('spacing.safe-right'),
          },
          '.theme-transition': {
            '@apply transition-colors duration-250': {},
          },
        });
      },
    ],
}