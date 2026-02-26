/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

export interface AccessibilitySettings {
  highContrast: boolean;
  textScale: number; // 1.0 to 2.0
  reducedMotion: boolean;
  keyboardShortcutsEnabled: boolean;
}

interface AccessibilityContextValue {
  settings: AccessibilitySettings;
  updateSettings: (updates: Partial<AccessibilitySettings>) => void;
  toggleHighContrast: () => void;
  increaseTextScale: () => void;
  decreaseTextScale: () => void;
  resetTextScale: () => void;
  announceToScreenReader: (message: string, priority?: 'polite' | 'assertive') => void;
}

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

const STORAGE_KEY = 'vaultdao_accessibility_settings';
const DEFAULT_SETTINGS: AccessibilitySettings = {
  highContrast: false,
  textScale: 1.0,
  reducedMotion: false,
  keyboardShortcutsEnabled: true,
};

export function AccessibilityProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AccessibilitySettings>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
      }
    } catch {
      // Ignore parse errors
    }
    
    // Check system preferences
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const prefersHighContrast = window.matchMedia('(prefers-contrast: high)').matches;
    
    return {
      ...DEFAULT_SETTINGS,
      reducedMotion: prefersReducedMotion,
      highContrast: prefersHighContrast,
    };
  });

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }, [settings]);

  // Apply settings to document
  useEffect(() => {
    const root = document.documentElement;
    
    // High contrast mode
    if (settings.highContrast) {
      root.classList.add('high-contrast');
    } else {
      root.classList.remove('high-contrast');
    }
    
    // Text scaling
    root.style.fontSize = `${settings.textScale * 100}%`;
    
    // Reduced motion
    if (settings.reducedMotion) {
      root.classList.add('reduce-motion');
    } else {
      root.classList.remove('reduce-motion');
    }
  }, [settings]);

  // Listen for system preference changes
  useEffect(() => {
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contrastQuery = window.matchMedia('(prefers-contrast: high)');
    
    const handleMotionChange = (e: MediaQueryListEvent) => {
      setSettings(prev => ({ ...prev, reducedMotion: e.matches }));
    };
    
    const handleContrastChange = (e: MediaQueryListEvent) => {
      setSettings(prev => ({ ...prev, highContrast: e.matches }));
    };
    
    motionQuery.addEventListener('change', handleMotionChange);
    contrastQuery.addEventListener('change', handleContrastChange);
    
    return () => {
      motionQuery.removeEventListener('change', handleMotionChange);
      contrastQuery.removeEventListener('change', handleContrastChange);
    };
  }, []);

  const updateSettings = useCallback((updates: Partial<AccessibilitySettings>) => {
    setSettings(prev => ({ ...prev, ...updates }));
  }, []);

  const toggleHighContrast = useCallback(() => {
    setSettings(prev => ({ ...prev, highContrast: !prev.highContrast }));
  }, []);

  const increaseTextScale = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      textScale: Math.min(prev.textScale + 0.1, 2.0),
    }));
  }, []);

  const decreaseTextScale = useCallback(() => {
    setSettings(prev => ({
      ...prev,
      textScale: Math.max(prev.textScale - 0.1, 1.0),
    }));
  }, []);

  const resetTextScale = useCallback(() => {
    setSettings(prev => ({ ...prev, textScale: 1.0 }));
  }, []);

  const announceToScreenReader = useCallback((message: string, priority: 'polite' | 'assertive' = 'polite') => {
    const announcement = document.createElement('div');
    announcement.setAttribute('role', 'status');
    announcement.setAttribute('aria-live', priority);
    announcement.setAttribute('aria-atomic', 'true');
    announcement.className = 'sr-only';
    announcement.textContent = message;
    
    document.body.appendChild(announcement);
    
    setTimeout(() => {
      document.body.removeChild(announcement);
    }, 1000);
  }, []);

  const value: AccessibilityContextValue = {
    settings,
    updateSettings,
    toggleHighContrast,
    increaseTextScale,
    decreaseTextScale,
    resetTextScale,
    announceToScreenReader,
  };

  return (
    <AccessibilityContext.Provider value={value}>
      {children}
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility(): AccessibilityContextValue {
  const context = useContext(AccessibilityContext);
  if (!context) {
    throw new Error('useAccessibility must be used within AccessibilityProvider');
  }
  return context;
}
