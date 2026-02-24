import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Settings, Trash2, AlertTriangle, Shield } from 'lucide-react';
import WidgetSandbox from './WidgetSandbox';
import WidgetMarketplace from './WidgetMarketplace';
import type { InstalledWidget, WidgetManifest, WidgetPermissions } from '../types/widget';

interface WidgetSystemProps {
  onWidgetAdd?: (widget: InstalledWidget) => void;
  onWidgetRemove?: (widgetId: string) => void;
}

const WidgetSystem: React.FC<WidgetSystemProps> = ({ onWidgetAdd, onWidgetRemove }) => {
  const [installedWidgets, setInstalledWidgets] = useState<InstalledWidget[]>([]);
  const [showMarketplace, setShowMarketplace] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<InstalledWidget | null>(null);
  const [showConfig, setShowConfig] = useState(false);

  useEffect(() => {
    loadInstalledWidgets();
  }, []);

  const loadInstalledWidgets = () => {
    const stored = localStorage.getItem('vaultdao-installed-widgets');
    if (stored) {
      setInstalledWidgets(JSON.parse(stored));
    }
  };

  const saveInstalledWidgets = (widgets: InstalledWidget[]) => {
    localStorage.setItem('vaultdao-installed-widgets', JSON.stringify(widgets));
    setInstalledWidgets(widgets);
  };

  const installWidget = useCallback((manifest: WidgetManifest) => {
    const newWidget: InstalledWidget = {
      id: manifest.metadata.id,
      metadata: manifest.metadata,
      permissions: manifest.permissions,
      settings: {},
      enabled: true,
      installDate: new Date().toISOString(),
      usageCount: 0,
    };

    const updated = [...installedWidgets, newWidget];
    saveInstalledWidgets(updated);
    onWidgetAdd?.(newWidget);
    setShowMarketplace(false);
  }, [installedWidgets, onWidgetAdd]);

  const uninstallWidget = (widgetId: string) => {
    const updated = installedWidgets.filter(w => w.id !== widgetId);
    saveInstalledWidgets(updated);
    onWidgetRemove?.(widgetId);
  };

  const toggleWidget = (widgetId: string) => {
    const updated = installedWidgets.map(w =>
      w.id === widgetId ? { ...w, enabled: !w.enabled } : w
    );
    saveInstalledWidgets(updated);
  };

  const updateWidgetSettings = (widgetId: string, settings: Record<string, any>) => {
    const updated = installedWidgets.map(w =>
      w.id === widgetId ? { ...w, settings } : w
    );
    saveInstalledWidgets(updated);
    setShowConfig(false);
  };

  const incrementUsage = (widgetId: string) => {
    const updated = installedWidgets.map(w =>
      w.id === widgetId
        ? { ...w, usageCount: w.usageCount + 1, lastUsed: new Date().toISOString() }
        : w
    );
    saveInstalledWidgets(updated);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold text-white">Widget System</h2>
        <button
          onClick={() => setShowMarketplace(true)}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span>Browse Marketplace</span>
        </button>
      </div>

      {/* Installed Widgets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {installedWidgets.map((widget) => (
          <div
            key={widget.id}
            className={`bg-gray-800 rounded-lg border ${
              widget.enabled ? 'border-gray-700' : 'border-gray-800 opacity-60'
            } p-4`}
          >
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                {widget.metadata.icon && (
                  <img
                    src={widget.metadata.icon}
                    alt={widget.metadata.name}
                    className="w-10 h-10 rounded"
                  />
                )}
                <div>
                  <h3 className="text-sm font-semibold text-white">
                    {widget.metadata.name}
                  </h3>
                  <p className="text-xs text-gray-400">{widget.metadata.version}</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    setSelectedWidget(widget);
                    setShowConfig(true);
                  }}
                  className="p-1 hover:bg-gray-700 rounded text-gray-400"
                  title="Configure"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={() => uninstallWidget(widget.id)}
                  className="p-1 hover:bg-gray-700 rounded text-red-400"
                  title="Uninstall"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            <p className="text-xs text-gray-400 mb-3">{widget.metadata.description}</p>

            {/* Permissions */}
            <div className="flex items-center gap-2 mb-3">
              <Shield className="h-3 w-3 text-gray-500" />
              <span className="text-xs text-gray-500">
                {Object.keys(widget.permissions).length} permissions
              </span>
            </div>

            {/* Stats */}
            <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
              <span>Used {widget.usageCount} times</span>
              {widget.lastUsed && (
                <span>Last: {new Date(widget.lastUsed).toLocaleDateString()}</span>
              )}
            </div>

            {/* Toggle */}
            <button
              onClick={() => toggleWidget(widget.id)}
              className={`w-full py-2 rounded-lg text-sm font-medium transition-colors ${
                widget.enabled
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
              }`}
            >
              {widget.enabled ? 'Enabled' : 'Disabled'}
            </button>
          </div>
        ))}
      </div>

      {/* Empty State */}
      {installedWidgets.length === 0 && (
        <div className="text-center py-12 bg-gray-800 rounded-lg border border-gray-700">
          <AlertTriangle className="h-12 w-12 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 mb-4">No widgets installed</p>
          <button
            onClick={() => setShowMarketplace(true)}
            className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
          >
            Browse Marketplace
          </button>
        </div>
      )}

      {/* Marketplace Modal */}
      {showMarketplace && (
        <WidgetMarketplace
          onInstall={installWidget}
          onClose={() => setShowMarketplace(false)}
          installedWidgets={installedWidgets}
        />
      )}

      {/* Configuration Modal */}
      {showConfig && selectedWidget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-gray-700 bg-gray-900 p-6">
            <h3 className="text-xl font-semibold text-white mb-4">
              Configure {selectedWidget.metadata.name}
            </h3>
            <WidgetConfigForm
              widget={selectedWidget}
              onSave={(settings) => updateWidgetSettings(selectedWidget.id, settings)}
              onCancel={() => setShowConfig(false)}
            />
          </div>
        </div>
      )}

      {/* Active Widgets Sandbox */}
      <div className="space-y-4">
        {installedWidgets
          .filter(w => w.enabled)
          .map(widget => (
            <WidgetSandbox
              key={widget.id}
              widget={widget}
              onLoad={() => incrementUsage(widget.id)}
            />
          ))}
      </div>
    </div>
  );
};

// Widget Configuration Form Component
interface WidgetConfigFormProps {
  widget: InstalledWidget;
  onSave: (settings: Record<string, any>) => void;
  onCancel: () => void;
}

const WidgetConfigForm: React.FC<WidgetConfigFormProps> = ({ widget, onSave, onCancel }) => {
  const [settings, setSettings] = useState(widget.settings);

  return (
    <div className="space-y-4">
      <div className="bg-gray-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-white mb-3">Permissions</h4>
        <div className="space-y-2">
          {Object.entries(widget.permissions).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between text-sm">
              <span className="text-gray-300 capitalize">{key}</span>
              <span className={value ? 'text-green-400' : 'text-gray-500'}>
                {value ? 'Granted' : 'Not granted'}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-gray-800 rounded-lg p-4">
        <h4 className="text-sm font-semibold text-white mb-3">Settings</h4>
        <textarea
          value={JSON.stringify(settings, null, 2)}
          onChange={(e) => {
            try {
              setSettings(JSON.parse(e.target.value));
            } catch {}
          }}
          className="w-full h-32 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-300 font-mono"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onSave(settings)}
          className="flex-1 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
        >
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default WidgetSystem;
