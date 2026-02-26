import { useEffect, useCallback } from 'react';

interface ShortcutConfig {
  key: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  preventDefault?: boolean;
  enabled?: boolean;
}

/**
 * Hook to register keyboard shortcuts
 * @param config - Shortcut configuration
 * @param callback - Function to call when shortcut is triggered
 */
export function useKeyboardShortcut(
  config: ShortcutConfig,
  callback: () => void
) {
  const handleKeyPress = useCallback(
    (event: KeyboardEvent) => {
      if (config.enabled === false) return;

      // Don't trigger shortcuts when typing in inputs
      const target = event.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable
      ) {
        return;
      }

      const matchesKey = event.key.toLowerCase() === config.key.toLowerCase();
      const matchesCtrl = config.ctrlKey ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey;
      const matchesAlt = config.altKey ? event.altKey : !event.altKey;
      const matchesShift = config.shiftKey ? event.shiftKey : !event.shiftKey;
      const matchesMeta = config.metaKey ? event.metaKey : true;

      if (matchesKey && matchesCtrl && matchesAlt && matchesShift && matchesMeta) {
        if (config.preventDefault !== false) {
          event.preventDefault();
        }
        callback();
      }
    },
    [config, callback]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);
}

export default useKeyboardShortcut;
