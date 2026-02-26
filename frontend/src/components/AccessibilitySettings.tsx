import React from 'react';
import { Eye, Type, Zap, Keyboard as KeyboardIcon } from 'lucide-react';
import { useAccessibility } from '../contexts/AccessibilityContext';

export function AccessibilitySettings() {
  const {
    settings,
    toggleHighContrast,
    increaseTextScale,
    decreaseTextScale,
    resetTextScale,
    updateSettings,
  } = useAccessibility();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">Accessibility Settings</h2>
        <p className="text-gray-400 text-sm">
          Customize your experience to meet your accessibility needs
        </p>
      </div>

      {/* High Contrast Mode */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Eye className="w-6 h-6 text-purple-400" aria-hidden="true" />
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
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start gap-4 mb-4">
          <div className="p-3 bg-purple-500/20 rounded-lg">
            <Type className="w-6 h-6 text-purple-400" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-white mb-1">Text Size</h3>
            <p className="text-sm text-gray-400">
              Adjust text size from 100% to 200% (Current: {Math.round(settings.textScale * 100)}%)
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={decreaseTextScale}
            disabled={settings.textScale <= 1.0}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            aria-label="Decrease text size"
          >
            A-
          </button>
          
          <div className="flex-1">
            <input
              type="range"
              min="1.0"
              max="2.0"
              step="0.1"
              value={settings.textScale}
              onChange={(e) => updateSettings({ textScale: parseFloat(e.target.value) })}
              className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500"
              aria-label="Text size slider"
              aria-valuemin={1.0}
              aria-valuemax={2.0}
              aria-valuenow={settings.textScale}
              aria-valuetext={`${Math.round(settings.textScale * 100)}%`}
            />
          </div>
          
          <button
            onClick={increaseTextScale}
            disabled={settings.textScale >= 2.0}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            aria-label="Increase text size"
          >
            A+
          </button>
          
          <button
            onClick={resetTextScale}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            aria-label="Reset text size to default"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Reduced Motion */}
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <Zap className="w-6 h-6 text-purple-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">Reduced Motion</h3>
              <p className="text-sm text-gray-400">
                Minimizes animations and transitions for users sensitive to motion
              </p>
            </div>
          </div>
          <button
            onClick={() => updateSettings({ reducedMotion: !settings.reducedMotion })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
              settings.reducedMotion ? 'bg-purple-600' : 'bg-gray-600'
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
      <div className="bg-gray-800/50 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-purple-500/20 rounded-lg">
              <KeyboardIcon className="w-6 h-6 text-purple-400" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white mb-1">Keyboard Shortcuts</h3>
              <p className="text-sm text-gray-400">
                Enable keyboard shortcuts for faster navigation (Press ? to view shortcuts)
              </p>
            </div>
          </div>
          <button
            onClick={() => updateSettings({ keyboardShortcutsEnabled: !settings.keyboardShortcutsEnabled })}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
              settings.keyboardShortcutsEnabled ? 'bg-purple-600' : 'bg-gray-600'
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

      {/* Info Box */}
      <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
        <p className="text-sm text-blue-300">
          <strong>Note:</strong> These settings are saved locally and will persist across sessions. 
          Some settings may also respect your system preferences.
        </p>
      </div>
    </div>
  );
}

export default AccessibilitySettings;
