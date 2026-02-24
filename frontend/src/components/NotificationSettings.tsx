/**
 * Notification settings UI for issue #25.
 * Event toggles, method toggles, frequency, DND, browser permission, preview, and test.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_METHODS,
  NOTIFICATION_FREQUENCIES,
  loadNotificationPreferences,
  saveNotificationPreferences,
  getBrowserNotificationPermission,
  requestBrowserNotificationPermission,
  type NotificationEventKey,
  type NotificationMethod,
  type NotificationPreferences,
} from '../utils/notifications';
import { useToast } from '../hooks/useToast';
import { Bell } from 'lucide-react';

// ---- Labels ----
const EVENT_LABELS: Record<NotificationEventKey, string> = {
  new_proposal: 'New proposal',
  proposal_approved: 'Proposal approved',
  proposal_executed: 'Proposal executed',
  proposal_rejected: 'Proposal rejected',
  signer_updated: 'Signer updated',
  config_updated: 'Config updated',
  spending_limit_warning: 'Spending limit warning',
  audit_error: 'Audit error',
  audit_tamper: 'Audit tampering detected',
  audit_fetch_error: 'Audit fetch error',
  no_data: 'No data available',
  preview_ready: 'Preview ready',
  preview_error: 'Preview error',
  report_downloaded: 'Report downloaded',
  report_error: 'Report error',
  export_success: 'Export successful',
  export_error: 'Export error',
  approval_failed: 'Approval failed',
  approval_success: 'Approval successful',
};

const METHOD_LABELS: Record<NotificationMethod, string> = {
  toast: 'In-app toast',
  browser: 'Browser notification',
  email: 'Email (UI only)',
};

const FREQUENCY_LABELS: Record<(typeof NOTIFICATION_FREQUENCIES)[number], string> = {
  'real-time': 'Real-time',
  daily: 'Daily digest',
  weekly: 'Weekly digest',
  off: 'Off',
};

// ---- Toggle ----
function Toggle({
  checked,
  onChange,
  id,
  label,
  helpText,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id: string;
  label: string;
  helpText?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-3">
      <div className="min-w-0">
        <label htmlFor={id} className="font-medium text-white cursor-pointer">
          {label}
        </label>
        {helpText && <p className="text-sm text-gray-400 mt-0.5">{helpText}</p>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${label}: ${checked ? 'on' : 'off'}`}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`
          relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent
          transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 focus:ring-offset-gray-900
          disabled:cursor-not-allowed disabled:opacity-50
          ${checked ? 'bg-purple-600' : 'bg-gray-600'}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0
            transition duration-200 ease-in-out
            ${checked ? 'translate-x-5' : 'translate-x-1'}
          `}
        />
      </button>
    </div>
  );
}

// ---- Radio group ----
function RadioGroup<T extends string>({
  value,
  options,
  labels,
  onChange,
  name,
  helpText,
}: {
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T) => void;
  name: string;
  helpText?: string;
}) {
  return (
    <fieldset>
      {helpText && <p className="text-sm text-gray-400 mb-3">{helpText}</p>}
      <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={name}>
        {options.map((opt) => (
          <label
            key={opt}
            className="flex items-center gap-2 cursor-pointer min-h-[44px] sm:min-h-0"
          >
            <input
              type="radio"
              name={name}
              checked={value === opt}
              onChange={() => onChange(opt)}
              className="h-4 w-4 border-gray-600 bg-gray-900 text-purple-600 focus:ring-purple-500"
            />
            <span className="text-white">{labels[opt as keyof typeof labels]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const NotificationSettings: React.FC = () => {
  const [prefs, setPrefs] = useState<NotificationPreferences>(() => loadNotificationPreferences());
  const [perm, setPerm] = useState<ReturnType<typeof getBrowserNotificationPermission>>('default');
  const [requestingPerm, setRequestingPerm] = useState(false);
  const { sendTestNotification } = useToast();

  const refreshPerm = useCallback(() => {
    setPerm(getBrowserNotificationPermission());
  }, []);

  useEffect(() => {
    refreshPerm();
  }, [refreshPerm]);

  const save = useCallback((next: NotificationPreferences) => {
    setPrefs(next);
    saveNotificationPreferences(next);
  }, []);

  const setEvent = (key: NotificationEventKey, enabled: boolean) => {
    const next = {
      ...prefs,
      events: { ...prefs.events, [key]: enabled },
    };
    save(next);
  };

  const setMethod = (method: NotificationMethod, enabled: boolean) => {
    const next = {
      ...prefs,
      methods: { ...prefs.methods, [method]: enabled },
    };
    save(next);
  };

  const setFrequency = (frequency: NotificationPreferences['frequency']) => {
    save({ ...prefs, frequency });
  };

  const setDnd = (updates: Partial<NotificationPreferences['dnd']>) => {
    save({
      ...prefs,
      dnd: { ...prefs.dnd, ...updates },
    });
  };

  const handleRequestPermission = async () => {
    setRequestingPerm(true);
    try {
      await requestBrowserNotificationPermission();
      refreshPerm();
    } finally {
      setRequestingPerm(false);
    }
  };

  const eventEnabled = (key: NotificationEventKey) => prefs.events[key] !== false;
  const methodEnabled = (m: NotificationMethod) => prefs.methods[m] === true;

  return (
    <div className="space-y-6 min-w-0 max-w-full">
      {/* Event toggles */}
      <section className="min-w-0">
        <h4 className="text-base font-semibold text-white mb-2">Notification events</h4>
        <p className="text-sm text-gray-400 mb-4">
          Choose which events trigger notifications. Disabled events are never notified.
        </p>
        <div className="space-y-1 divide-y divide-gray-700">
          {NOTIFICATION_EVENTS.map((key) => (
            <Toggle
              key={key}
              id={`event-${key}`}
              label={EVENT_LABELS[key]}
              checked={eventEnabled(key)}
              onChange={(v) => setEvent(key, v)}
            />
          ))}
        </div>
      </section>

      {/* Method toggles */}
      <section>
        <h4 className="text-base font-semibold text-white mb-2">Notification methods</h4>
        <p className="text-sm text-gray-400 mb-4">
          Where to deliver notifications. Email is shown for future use only.
        </p>
        <div className="space-y-1 divide-y divide-gray-700">
          {NOTIFICATION_METHODS.map((method) => (
            <Toggle
              key={method}
              id={`method-${method}`}
              label={METHOD_LABELS[method]}
              helpText={
                method === 'browser'
                  ? 'Uses system notifications; requires browser permission below.'
                  : method === 'email'
                    ? 'Coming soon.'
                    : undefined
              }
              checked={methodEnabled(method)}
              onChange={(v) => setMethod(method, v)}
            />
          ))}
        </div>
      </section>

      {/* Frequency */}
      <section>
        <h4 className="text-base font-semibold text-white mb-2">Frequency</h4>
        <RadioGroup
          name="frequency"
          value={prefs.frequency}
          options={NOTIFICATION_FREQUENCIES}
          labels={FREQUENCY_LABELS}
          onChange={setFrequency}
          helpText="Real-time delivers immediately. Daily/weekly batches events into digests. Off disables all."
        />
      </section>

      {/* DND */}
      <section>
        <h4 className="text-base font-semibold text-white mb-2">Do Not Disturb</h4>
        <p className="text-sm text-gray-400 mb-4">
          Suppress notifications during this time window. Uses 24-hour format.
        </p>
        <div className="space-y-4">
          <Toggle
            id="dnd-enabled"
            label="Enable DND"
            checked={prefs.dnd.enabled}
            onChange={(v) => setDnd({ enabled: v })}
          />
          {prefs.dnd.enabled && (
            <div className="flex flex-col sm:flex-row gap-4 sm:gap-6">
              <div>
                <label htmlFor="dnd-start" className="block text-sm font-medium text-gray-300 mb-1">
                  Start (24h)
                </label>
                <input
                  id="dnd-start"
                  type="text"
                  value={prefs.dnd.start}
                  onChange={(e) => setDnd({ start: e.target.value })}
                  placeholder="22:00"
                  className="w-full sm:w-24 px-3 py-2 rounded-lg bg-gray-900 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px] sm:min-h-0"
                />
              </div>
              <div>
                <label htmlFor="dnd-end" className="block text-sm font-medium text-gray-300 mb-1">
                  End (24h)
                </label>
                <input
                  id="dnd-end"
                  type="text"
                  value={prefs.dnd.end}
                  onChange={(e) => setDnd({ end: e.target.value })}
                  placeholder="08:00"
                  className="w-full sm:w-24 px-3 py-2 rounded-lg bg-gray-900 border border-gray-600 text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px] sm:min-h-0"
                />
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Browser permission */}
      <section>
        <h4 className="text-base font-semibold text-white mb-2">Browser notifications</h4>
        <p className="text-sm text-gray-400 mb-4">
          Allow this site to show system notifications. Required for the browser method above.
        </p>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <span
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${
              perm === 'granted'
                ? 'bg-green-500/20 text-green-400'
                : perm === 'denied'
                  ? 'bg-red-500/20 text-red-400'
                  : 'bg-gray-700 text-gray-400'
            }`}
          >
            <Bell size={16} />
            Status: {perm === 'granted' ? 'Granted' : perm === 'denied' ? 'Denied' : perm === 'unsupported' ? 'Unsupported' : 'Not asked'}
          </span>
          {perm !== 'granted' && perm !== 'denied' && perm !== 'unsupported' && (
            <button
              type="button"
              onClick={handleRequestPermission}
              disabled={requestingPerm}
              className="min-h-[44px] sm:min-h-0 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm disabled:opacity-50 touch-manipulation"
            >
              {requestingPerm ? 'Requesting...' : 'Request permission'}
            </button>
          )}
        </div>
        {perm === 'denied' && (
          <p className="text-sm text-amber-400 mt-2">
            Permission was denied. Enable it in your browser settings to receive browser notifications.
          </p>
        )}
      </section>

      {/* Preview */}
      <section>
        <h4 className="text-base font-semibold text-white mb-2">Preview</h4>
        <p className="text-sm text-gray-400 mb-4">
          How notifications will appear with your current method settings.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {methodEnabled('toast') && (
            <div className="rounded-lg border border-gray-600 bg-blue-500/10 text-blue-400 p-4">
              <p className="text-xs font-medium text-blue-400/80 uppercase mb-1">Toast</p>
              <p className="text-sm">Sample proposal approved notification</p>
            </div>
          )}
          {methodEnabled('browser') && (
            <div className="rounded-lg border border-gray-600 bg-gray-700/50 p-4">
              <p className="text-xs font-medium text-gray-400 uppercase mb-1">Browser</p>
              <p className="text-sm text-gray-300">System notification: &quot;VaultDAO — Sample message&quot;</p>
            </div>
          )}
          {!methodEnabled('toast') && !methodEnabled('browser') && (
            <p className="text-sm text-gray-500 col-span-2">
              Enable toast or browser above to see previews.
            </p>
          )}
        </div>
      </section>

      {/* Test notification */}
      <section className="pt-2">
        <button
          type="button"
          onClick={sendTestNotification}
          className="min-h-[44px] flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white text-sm touch-manipulation"
        >
          <Bell size={18} />
          Send test notification
        </button>
        <p className="text-sm text-gray-400 mt-2">
          Sends a test notification using your current preferences (methods, frequency, DND).
        </p>
      </section>
    </div>
  );
};

export default NotificationSettings;
