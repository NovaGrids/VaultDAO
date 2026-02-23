import React, { useEffect, useState, useCallback } from 'react';
import { X, Keyboard } from 'lucide-react';
import { useAccessibility } from '../context/AccessibilityContext';
import { useNavigate } from 'react-router-dom';

interface Shortcut {
  key: string;
  description: string;
  action: () => void;
  category: 'navigation' | 'actions' | 'accessibility';
}

const KeyboardShortcuts: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const { settings, announceToScreenReader } = useAccessibility();
  const navigate = useNavigate();

  const shortcuts: Shortcut[] = [
    // Navigation
    { key: 'Alt+1', description: 'Go to Overview', action: () => navigate('/dashboard'), category: 'navigation' },
    { key: 'Alt+2', description: 'Go to Proposals', action: () => navigate('/dashboard/proposals'), category: 'navigation' },
    { key: 'Alt+3', description: 'Go to Activity', action: () => navigate('/dashboard/activity'), category: 'navigation' },
    { key: 'Alt+4', description: 'Go to Templates', action: () => navigate('/dashboard/templates'), category: 'navigation' },
    { key: 'Alt+5', description: 'Go to Analytics', action: () => navigate('/dashboard/analytics'), category: 'navigation' },
    { key: 'Alt+6', description: 'Go to Settings', action: () => navigate('/dashboard/settings'), category: 'navigation' },
    
    // Actions
    { key: 'Ctrl+K', description: 'Open keyboard shortcuts', action: () => setIsOpen(true), category: 'actions' },
    { key: 'Escape', description: 'Close modal/dialog', action: () => setIsOpen(false), category: 'actions' },
    { key: 'Ctrl+/', description: 'Toggle sidebar', action: () => {}, category: 'actions' },
    
    // Accessibility
    { key: 'Alt+H', description: 'Toggle high contrast', action: () => {}, category: 'accessibility' },
    { key: 'Alt++', description: 'Increase text size', action: () => {}, category: 'accessibility' },
    { key: 'Alt+-', description: 'Decrease text size', action: () => {}, category: 'accessibility' },
  ];

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (!settings.keyboardShortcutsEnabled) return;

    const key = [
      event.ctrlKey && 'Ctrl',
      event.altKey && 'Alt',
      event.shiftKey && 'Shift',
      event.key.toUpperCase()
    ].filter(Boolean).join('+');

    const shortcut = shortcuts.find(s => s.key === key);
    if (shortcut) {
      event.preventDefault();
      shortcut.action();
      announceToScreenReader(`Activated: ${shortcut.description}`);
    }
  }, [settings.keyboardShortcutsEnabled, shortcuts, announceToScreenReader]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-4 right-4 p-3 bg-purple-600 hover:bg-purple-700 rounded-full shadow-lg transition-colors z-40 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900"
        aria-label="Open keyboard shortcuts help"
        title="Keyboard shortcuts (Ctrl+K)"
      >
        <Keyboard size={20} className="text-white" />
      </button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-title"
    >
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b border-gray-700 flex items-center justify-between">
          <h2 id="shortcuts-title" className="text-xl font-bold text-white flex items-center gap-2">
            <Keyboard size={24} />
            Keyboard Shortcuts
          </h2>
          <button
            onClick={() => setIsOpen(false)}
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
            aria-label="Close keyboard shortcuts"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar">
          {['navigation', 'actions', 'accessibility'].map(category => (
            <div key={category} className="mb-6 last:mb-0">
              <h3 className="text-lg font-semibold text-purple-400 mb-3 capitalize">
                {category}
              </h3>
              <div className="space-y-2">
                {shortcuts
                  .filter(s => s.category === category)
                  .map((shortcut, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg"
                    >
                      <span className="text-gray-300">{shortcut.description}</span>
                      <kbd className="px-3 py-1 bg-gray-700 text-white rounded border border-gray-600 font-mono text-sm">
                        {shortcut.key}
                      </kbd>
                    </div>
                  ))}
              </div>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-gray-700 bg-gray-900/50">
          <p className="text-sm text-gray-400 text-center">
            Press <kbd className="px-2 py-1 bg-gray-700 rounded text-xs">Escape</kbd> to close this dialog
          </p>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcuts;
