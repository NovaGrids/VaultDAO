import React, { useEffect, useState, useCallback } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useAccessibility } from '../contexts/AccessibilityContext';

interface Shortcut {
  key: string;
  description: string;
  action: () => void;
  category: 'navigation' | 'actions' | 'accessibility';
}

interface KeyboardShortcutsProps {
  shortcuts: Shortcut[];
}

export function KeyboardShortcuts({ shortcuts }: KeyboardShortcutsProps) {
  const [isOpen, setIsOpen] = useState(false);
  const { settings } = useAccessibility();

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (!settings.keyboardShortcutsEnabled) return;

    // Toggle shortcuts panel with ?
    if (event.key === '?' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const target = event.target as HTMLElement;
      // Don't trigger if user is typing in an input
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
      
      event.preventDefault();
      setIsOpen(prev => !prev);
      return;
    }

    // Close panel with Escape
    if (event.key === 'Escape' && isOpen) {
      event.preventDefault();
      setIsOpen(false);
      return;
    }

    // Execute shortcuts
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    const matchedShortcut = shortcuts.find(s => {
      const keys = s.key.toLowerCase().split('+');
      const hasCtrl = keys.includes('ctrl') || keys.includes('cmd');
      const hasAlt = keys.includes('alt');
      const hasShift = keys.includes('shift');
      const mainKey = keys[keys.length - 1];

      return (
        event.key.toLowerCase() === mainKey &&
        (hasCtrl ? (event.ctrlKey || event.metaKey) : !event.ctrlKey && !event.metaKey) &&
        (hasAlt ? event.altKey : !event.altKey) &&
        (hasShift ? event.shiftKey : !event.shiftKey)
      );
    });

    if (matchedShortcut) {
      event.preventDefault();
      matchedShortcut.action();
    }
  }, [shortcuts, settings.keyboardShortcutsEnabled, isOpen]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleKeyPress]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 z-50 p-3 bg-purple-600 hover:bg-purple-700 text-white rounded-full shadow-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        aria-label="Show keyboard shortcuts"
        title="Keyboard shortcuts (Press ?)"
      >
        <Keyboard className="w-5 h-5" aria-hidden="true" />
      </button>
    );
  }

  const categorizedShortcuts = {
    navigation: shortcuts.filter(s => s.category === 'navigation'),
    actions: shortcuts.filter(s => s.category === 'actions'),
    accessibility: shortcuts.filter(s => s.category === 'accessibility'),
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="bg-gray-900 border border-gray-700 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 p-4 sm:p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Keyboard className="w-6 h-6 text-purple-400" aria-hidden="true" />
            <h2 id="shortcuts-title" className="text-xl font-semibold text-white">
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Close keyboard shortcuts"
          >
            <X className="w-5 h-5 text-gray-400" aria-hidden="true" />
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-6">
          {categorizedShortcuts.navigation.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-white mb-3">Navigation</h3>
              <div className="space-y-2">
                {categorizedShortcuts.navigation.map((shortcut, index) => (
                  <ShortcutItem key={index} shortcut={shortcut} />
                ))}
              </div>
            </section>
          )}

          {categorizedShortcuts.actions.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-white mb-3">Actions</h3>
              <div className="space-y-2">
                {categorizedShortcuts.actions.map((shortcut, index) => (
                  <ShortcutItem key={index} shortcut={shortcut} />
                ))}
              </div>
            </section>
          )}

          {categorizedShortcuts.accessibility.length > 0 && (
            <section>
              <h3 className="text-lg font-semibold text-white mb-3">Accessibility</h3>
              <div className="space-y-2">
                {categorizedShortcuts.accessibility.map((shortcut, index) => (
                  <ShortcutItem key={index} shortcut={shortcut} />
                ))}
              </div>
            </section>
          )}

          <div className="pt-4 border-t border-gray-700">
            <p className="text-sm text-gray-400">
              Press <kbd className="kbd">?</kbd> to toggle this panel
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutItem({ shortcut }: { shortcut: Shortcut }) {
  const keys = shortcut.key.split('+');
  
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-gray-800/50 rounded-lg">
      <span className="text-sm text-gray-300">{shortcut.description}</span>
      <div className="flex items-center gap-1">
        {keys.map((key, index) => (
          <React.Fragment key={index}>
            <kbd className="kbd">{key}</kbd>
            {index < keys.length - 1 && (
              <span className="text-gray-500 text-xs">+</span>
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

export default KeyboardShortcuts;
