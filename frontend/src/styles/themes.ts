export const themeStyles = {
  light: {
    background: 'bg-white',
    foreground: 'text-gray-900',
    card: 'bg-gray-50',
    border: 'border-gray-200',
    muted: 'text-gray-500',
    accent: 'text-purple-600',
    /** Glassmorphism panel — light mode uses white with subtle blur */
    glass: 'bg-white/80 backdrop-blur-md border border-gray-200/80 shadow-sm',
  },
  dark: {
    background: 'bg-gray-900',
    foreground: 'text-white',
    card: 'bg-gray-800',
    border: 'border-gray-700',
    muted: 'text-gray-400',
    accent: 'text-purple-400',
    /** Glassmorphism panel — dark mode */
    glass: 'bg-gray-800/50 backdrop-blur-md border border-gray-700/50',
  },
  'high-contrast': {
    background: 'bg-black',
    foreground: 'text-white',
    card: 'bg-black border-white',
    border: 'border-white',
    muted: 'text-yellow-400',
    accent: 'text-yellow-400',
    glass: 'bg-black border-2 border-white',
  },
};

/**
 * Tailwind utility classes for glassmorphism panels that work in both
 * light and dark mode. Use these instead of raw bg-gray-800/50 classes.
 *
 * Usage:
 *   <div className={glassPanel}>...</div>
 */
export const glassPanel =
  'bg-white/80 dark:bg-gray-800/50 backdrop-blur-md border border-gray-200/80 dark:border-gray-700/50 shadow-sm dark:shadow-none';

export const glassCard =
  'bg-white dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-xl';

export const glassModal =
  'bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl';

// CSS Variables to be injected or used in style props if needed
export const themeVariables = {
  light: {
    '--bg-main': '#ffffff',
    '--text-main': '#111827',
    '--border-main': '#e5e7eb',
  },
  dark: {
    '--bg-main': '#111827',
    '--text-main': '#ffffff',
    '--border-main': '#374151',
  },
  'high-contrast': {
    '--bg-main': '#000000',
    '--text-main': '#ffffff',
    '--border-main': '#ffffff',
  }
};