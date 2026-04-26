export const themeStyles = {
  light: {
    background: 'bg-white',
    foreground: 'text-gray-900',
    card: 'bg-gray-50',
    border: 'border-gray-200',
    muted: 'text-gray-500',
    accent: 'text-purple-600',
    glass: 'bg-white/70 backdrop-blur-md',
  },
  dark: {
    background: 'bg-gray-900',
    foreground: 'text-white',
    card: 'bg-gray-800',
    border: 'border-gray-700',
    muted: 'text-gray-400',
    accent: 'text-purple-400',
    glass: 'bg-gray-800/50 backdrop-blur-md',
  },
  'high-contrast': {
    background: 'bg-black',
    foreground: 'text-white',
    card: 'bg-black border-white',
    border: 'border-white',
    muted: 'text-yellow-400',
    accent: 'text-yellow-400',
    glass: 'bg-black border-2 border-white',
  }
};

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