import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

interface AccessibilitySettings {
  highContrast: boolean;
  textScale: number;
  reducedMotion: boolean;
  keyboardShortcutsEnabled: boolean;
}

interface AccessibilityContextValue {
  settings: AccessibilitySettings;
  toggleHighContrast: () => void;
  setTextScale: (scale: number) => void;
  toggleReducedMotion: () => void;
  toggleKeyboardShortcuts: () => void;
  announceToScreenReader: (message: string, priority?: 'polite' | 'assertive') => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  textScale: 1,
  reducedMotion: false,
  keyboardShortcutsEnabled: true,
};

export const AccessibilityProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    const stored = localStorage.getItem('accessibility-settings');
    return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
  });

  const [announcementElement, setAnnouncementElement] = useState<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = document.createElement('div');
    element.setAttribute('role', 'status');
    element.setAttribute('aria-live', 'polite');
    element.setAttribute('aria-atomic', 'true');
    element.className = 'sr-only';
    document.body.appendChild(element);
    setAnnouncementElement(element);

    return () => {
      document.body.removeChild(element);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('accessibility-settings', JSON.stringify(settings));

    // Apply high contrast mode
    if (settings.highContrast) {
      document.documentElement.classList.add('high-contrast');
    } else {
      document.documentElement.classList.remove('high-contrast');
    }

    // Apply text scaling
    document.documentElement.style.fontSize = `${settings.textScale * 100}%`;

    // Apply reduced motion
    if (settings.reducedMotion) {
      document.documentElement.classList.add('reduce-motion');
    } else {
      document.documentElement.classList.remove('reduce-motion');
    }
  }, [settings]);

  const toggleHighContrast = useCallback(() => {
    setSettings(prev => ({ ...prev, highContrast: !prev.highContrast }));
  }, []);

  const setTextScale = useCallback((scale: number) => {
    const clampedScale = Math.max(1, Math.min(2, scale));
    setSettings(prev => ({ ...prev, textScale: clampedScale }));
  }, []);

  const toggleReducedMotion = useCallback(() => {
    setSettings(prev => ({ ...prev, reducedMotion: !prev.reducedMotion }));
  }, []);

  const toggleKeyboardShortcuts = useCallback(() => {
    setSettings(prev => ({ ...prev, keyboardShortcutsEnabled: !prev.keyboardShortcutsEnabled }));
  }, []);

  const announceToScreenReader = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    if (announcementElement) {
      announcementElement.setAttribute('aria-live', priority);
      announcementElement.textContent = message;
      setTimeout(() => {
        announcementElement.textContent = '';
      }, 1000);
    }
  }, [announcementElement]);

  const value: AccessibilityContextValue = {
    settings,
    toggleHighContrast,
    setTextScale,
    toggleReducedMotion,
    toggleKeyboardShortcuts,
    announceToScreenReader,
  };

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
};

export const useAccessibility = () => {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within AccessibilityProvider');
  }
  return context;
};
