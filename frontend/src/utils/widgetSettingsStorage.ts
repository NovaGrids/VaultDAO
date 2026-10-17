import type { InstalledWidget } from '../types/widget';

/** localStorage key holding the installed widgets array (shared with WidgetSystem). */
export const INSTALLED_WIDGETS_STORAGE_KEY = 'vaultdao-installed-widgets';

/** Upper bound on the serialized size of a single widget's settings. */
export const MAX_WIDGET_SETTINGS_BYTES = 64 * 1024;

export type WidgetSettingsResult =
  | { ok: true; settings: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Check that a value can be stored as widget settings: a plain JSON object,
 * serializable, and within the size cap. Returns a normalized copy on success.
 */
export function validateWidgetSettings(value: unknown): WidgetSettingsResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, error: 'Settings must be a JSON object' };
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { ok: false, error: 'Settings must be JSON-serializable' };
  }
  if (serialized === undefined) {
    return { ok: false, error: 'Settings must be JSON-serializable' };
  }

  if (new TextEncoder().encode(serialized).length > MAX_WIDGET_SETTINGS_BYTES) {
    return { ok: false, error: `Settings exceed ${MAX_WIDGET_SETTINGS_BYTES} bytes` };
  }

  return { ok: true, settings: JSON.parse(serialized) as Record<string, unknown> };
}

/** Read the installed widgets from storage. Returns an empty list on any failure. */
export function readInstalledWidgets(): InstalledWidget[] {
  try {
    const stored = localStorage.getItem(INSTALLED_WIDGETS_STORAGE_KEY);
    return stored ? (JSON.parse(stored) as InstalledWidget[]) : [];
  } catch {
    return [];
  }
}

/**
 * Validate and persist settings for one installed widget.
 * Settings survive reloads because they are written into the installed-widgets store.
 */
export function persistWidgetSettings(widgetId: string, value: unknown): WidgetSettingsResult {
  const validation = validateWidgetSettings(value);
  if (!validation.ok) return validation;

  const widgets = readInstalledWidgets();
  const index = widgets.findIndex((widget) => widget.id === widgetId);
  if (index === -1) {
    return { ok: false, error: 'Widget is not installed' };
  }

  widgets[index] = { ...widgets[index], settings: validation.settings };

  try {
    localStorage.setItem(INSTALLED_WIDGETS_STORAGE_KEY, JSON.stringify(widgets));
  } catch {
    return { ok: false, error: 'Failed to save settings to storage' };
  }

  return validation;
}
