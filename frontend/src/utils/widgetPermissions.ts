import type { WidgetPermissions } from '../types/widget';

export type WidgetPermissionKey = keyof WidgetPermissions;

export const WIDGET_PERMISSION_KEYS: readonly WidgetPermissionKey[] = [
  'network',
  'storage',
  'wallet',
  'notifications',
  'proposals',
  'vaultConfig',
  'events',
  'navigation',
];

/** Routes a widget may navigate the host app to. Exact matches only. */
export const WIDGET_NAVIGATION_ALLOWLIST: readonly string[] = [
  '/dashboard/proposals',
  '/dashboard/activity',
  '/dashboard/analytics',
  '/dashboard/governance',
];

const NAVIGATION_PATH_PATTERN = /^\/[a-z0-9-]+(\/[a-z0-9-]+)*$/;

/**
 * Returns the path if it is a well-formed, allowlisted route, otherwise null.
 * Absolute URLs, protocol-relative paths, query strings and traversal segments
 * fail the pattern before the allowlist is consulted.
 */
export function resolveNavigationPath(path: unknown, allowlist: readonly string[] = WIDGET_NAVIGATION_ALLOWLIST): string | null {
  if (typeof path !== 'string' || !NAVIGATION_PATH_PATTERN.test(path)) return null;
  return allowlist.includes(path) ? path : null;
}

const CONSENT_STORAGE_KEY = 'vaultdao-widget-consents';

type ConsentRecord = Record<string, Partial<Record<WidgetPermissionKey, boolean>>>;

export interface PermissionDeniedResponse {
  error: 'permission_denied';
  permission: WidgetPermissionKey;
}

/** Returns a typed denial payload for the widget bridge. */
export function permissionDenied(permission: WidgetPermissionKey): PermissionDeniedResponse {
  return { error: 'permission_denied', permission };
}

/** Maps each data request the sandbox answers to the permission it requires. */
const DATA_ACTION_PERMISSIONS: Record<string, WidgetPermissionKey> = {
  getProposals: 'proposals',
  getVaultConfig: 'vaultConfig',
};

/** Returns the permission required for a `data` message, or null if the action is unknown. */
export function getDataActionPermission(action: unknown): WidgetPermissionKey | null {
  if (typeof action !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(DATA_ACTION_PERMISSIONS, action)
    ? DATA_ACTION_PERMISSIONS[action]
    : null;
}

export function hasPermission(permissions: WidgetPermissions, key: WidgetPermissionKey): boolean {
  return permissions[key] === true;
}

function readConsentRecord(): ConsentRecord {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return typeof parsed === 'object' && parsed !== null ? (parsed as ConsentRecord) : {};
  } catch {
    return {};
  }
}

function getStoredConsent(widgetId: string, permission: WidgetPermissionKey): boolean | undefined {
  return readConsentRecord()[widgetId]?.[permission];
}

function storeConsent(widgetId: string, permission: WidgetPermissionKey, granted: boolean): void {
  try {
    const record = readConsentRecord();
    record[widgetId] = { ...record[widgetId], [permission]: granted };
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
  } catch {
    // Storage unavailable: the decision still applies for this request.
  }
}

/**
 * Decide a widget's permission request.
 * Undeclared permissions are denied without prompting. Declared ones use the
 * stored per-widget decision, or ask the user once and remember the answer.
 */
export function resolvePermissionRequest(
  widget: { id: string; permissions: WidgetPermissions },
  permission: unknown,
  askUser: (permission: WidgetPermissionKey) => boolean,
): boolean {
  if (!WIDGET_PERMISSION_KEYS.includes(permission as WidgetPermissionKey)) return false;
  const key = permission as WidgetPermissionKey;
  if (!hasPermission(widget.permissions, key)) return false;

  const stored = getStoredConsent(widget.id, key);
  if (stored !== undefined) return stored;

  const granted = askUser(key);
  storeConsent(widget.id, key, granted);
  return granted;
}
