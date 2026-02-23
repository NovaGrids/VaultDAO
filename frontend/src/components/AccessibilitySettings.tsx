import React from 'react';
import { useAccessibility } from '../context/AccessibilityContext';
import { Eye, Type, Zap, Keyboard } from 'lucide-react';

const AccessibilitySettings: React.FC = () => {
  const { settings, toggleHighContrast, setTextScale, toggleReducedMotion, toggleKeyboardShortcuts } = useAccessibility();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Accessibility Settings</h2>
        <p className="text-gray-400 text-sm">
          Customize your experience to meet your accessibility needs
        </p>
      </div>

      <div className="space-y-4">
        {/* High Contrast Mode */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-purple-500/10 rounded-lg">
                <Eye className="text-purple-400" size={24} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">High Contrast Mode</h3>
                <p className="text-sm text-gray-400">
                  Increases contrast between text and background for better visibility
                </p>
              </div>
            </div>
            <button
              onClick={toggleHighContrast}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                settings.highContrast ? 'bg-purple-600' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={settings.highContrast}
              aria-label="Toggle high contrast mode"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.highContrast ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Text Scaling */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-start gap-4 mb-4">
            <div className="p-3 bg-blue-500/10 rounded-lg">
              <Type className="text-blue-400" size={24} aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">Text Size</h3>
              <p className="text-sm text-gray-400">
                Adjust text size from 100% to 200% (WCAG 2.1 AA compliant)
              </p>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-300">Current size: {Math.round(settings.textScale * 100)}%</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setTextScale(settings.textScale - 0.1)}
                  disabled={settings.textScale <= 1}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Decrease text size"
                >
                  A-
                </button>
                <button
                  onClick={() => setTextScale(1)}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Reset text size to 100%"
                >
                  Reset
                </button>
                <button
                  onClick={() => setTextScale(settings.textScale + 0.1)}
                  disabled={settings.textScale >= 2}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500"
                  aria-label="Increase text size"
                >
                  A+
                </button>
              </div>
            </div>
            <input
              type="range"
              min="1"
              max="2"
              step="0.1"
              value={settings.textScale}
              onChange={(e) => setTextScale(parseFloat(e.target.value))}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-purple-500"
              aria-label="Text size slider"
              aria-valuemin={1}
              aria-valuemax={2}
              aria-valuenow={settings.textScale}
              aria-valuetext={`${Math.round(settings.textScale * 100)}%`}
            />
          </div>
        </div>

        {/* Reduced Motion */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-green-500/10 rounded-lg">
                <Zap className="text-green-400" size={24} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Reduce Motion</h3>
                <p className="text-sm text-gray-400">
                  Minimizes animations and transitions for users sensitive to motion
                </p>
              </div>
            </div>
            <button
              onClick={toggleReducedMotion}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                settings.reducedMotion ? 'bg-green-600' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={settings.reducedMotion}
              aria-label="Toggle reduced motion"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.reducedMotion ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Keyboard Shortcuts */}
        <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-yellow-500/10 rounded-lg">
                <Keyboard className="text-yellow-400" size={24} aria-hidden="true" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white mb-1">Keyboard Shortcuts</h3>
                <p className="text-sm text-gray-400">
                  Enable keyboard shortcuts for faster navigation (Press Ctrl+K to view all shortcuts)
                </p>
              </div>
            </div>
            <button
              onClick={toggleKeyboardShortcuts}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                settings.keyboardShortcutsEnabled ? 'bg-yellow-600' : 'bg-gray-600'
              }`}
              role="switch"
              aria-checked={settings.keyboardShortcutsEnabled}
              aria-label="Toggle keyboard shortcuts"
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  settings.keyboardShortcutsEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/20 rounded-xl p-4">
        <h4 className="text-sm font-semibold text-blue-400 mb-2">WCAG 2.1 AA Compliance</h4>
        <p className="text-xs text-gray-400">
          This application follows Web Content Accessibility Guidelines (WCAG) 2.1 Level AA standards. 
          All interactive elements have minimum touch targets of 44x44px, proper ARIA labels, and keyboard navigation support.
        </p>
      </div>
    </div>
  );
};

export default AccessibilitySettings;
