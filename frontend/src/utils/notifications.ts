/**
 * Notification preferences and helpers for issue #25.
 * Centralizes preference persistence, filtering, browser API, and digest queue.
 */

// ---- Event types ----
export const NOTIFICATION_EVENTS = [
  'new_proposal',
  'proposal_approved',
  'proposal_executed',
  'proposal_rejected',
  'signer_updated',
  'config_updated',
  'spending_limit_warning',
  'audit_error',
  'audit_tamper',
  'audit_fetch_error',
  'no_data',
  'preview_ready',
  'preview_error',
  'report_downloaded',
  'report_error',
  'export_success',
  'export_error',
  'approval_failed',
  'approval_success',
] as const;

export type NotificationEventKey = (typeof NOTIFICATION_EVENTS)[number];

// ---- Methods ----
export const NOTIFICATION_METHODS = ['toast', 'browser', 'email'] as const;

export type NotificationMethod = (typeof NOTIFICATION_METHODS)[number];

// ---- Frequency ----
export const NOTIFICATION_FREQUENCIES = ['real-time', 'daily', 'weekly', 'off'] as const;

export type NotificationFrequency = (typeof NOTIFICATION_FREQUENCIES)[number];

// ---- DND ----
export interface DoNotDisturbConfig {
  enabled: boolean;
  /** HH:mm 24-hour (e.g. "22:00") */
  start: string;
  /** HH:mm 24-hour (e.g. "08:00") */
  end: string;
}

// ---- Preferences ----
export interface NotificationPreferences {
  /** Per-event toggles; if missing, treated as enabled for backward compat */
  events: Partial<Record<NotificationEventKey, boolean>>;
  /** Per-method toggles */
  methods: Partial<Record<NotificationMethod, boolean>>;
  frequency: NotificationFrequency;
  dnd: DoNotDisturbConfig;
}

// ---- Defaults ----
const DEFAULT_DND: DoNotDisturbConfig = {
  enabled: false,
  start: '22:00',
  end: '08:00',
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  events: {},
  methods: {
    toast: true,
    browser: false,
    email: false,
  },
  frequency: 'real-time',
  dnd: { ...DEFAULT_DND },
};

// ---- Storage ----
const STORAGE_KEY = 'vaultdao_notification_preferences';

/** Parses HH:mm string to minutes since midnight. Returns NaN if invalid. */
function parseHHmm(s: string): number {
  if (typeof s !== 'string') return NaN;
  const m = s.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}

/** Returns true if `now` falls within DND window (start..end, may wrap across midnight). */
export function isInDoNotDisturbWindow(dnd: DoNotDisturbConfig, now?: Date): boolean {
  if (!dnd.enabled) return false;
  const t = now ?? new Date();
  const curr = t.getHours() * 60 + t.getMinutes();
  const start = parseHHmm(dnd.start);
  const end = parseHHmm(dnd.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  if (start <= end) return curr >= start && curr < end;
  return curr >= start || curr < end;
}

function isEventKey(x: string): x is NotificationEventKey {
  return NOTIFICATION_EVENTS.includes(x as NotificationEventKey);
}

function isMethod(x: string): x is NotificationMethod {
  return NOTIFICATION_METHODS.includes(x as NotificationMethod);
}

function isFrequency(x: string): x is NotificationFrequency {
  return NOTIFICATION_FREQUENCIES.includes(x as NotificationFrequency);
}

function validatePreferences(raw: unknown): NotificationPreferences {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_PREFERENCES };
  const obj = raw as Record<string, unknown>;
  const events: Partial<Record<NotificationEventKey, boolean>> = {};
  if (obj.events && typeof obj.events === 'object') {
    for (const [k, v] of Object.entries(obj.events as Record<string, unknown>)) {
      if (isEventKey(k) && typeof v === 'boolean') events[k] = v;
    }
  }
  const methods: Partial<Record<NotificationMethod, boolean>> = { ...DEFAULT_PREFERENCES.methods };
  if (obj.methods && typeof obj.methods === 'object') {
    for (const [k, v] of Object.entries(obj.methods as Record<string, unknown>)) {
      if (isMethod(k) && typeof v === 'boolean') methods[k] = v;
    }
  }
  const frequency: NotificationFrequency = isFrequency(String(obj.frequency))
    ? (obj.frequency as NotificationFrequency)
    : DEFAULT_PREFERENCES.frequency;
  let dnd: DoNotDisturbConfig = { ...DEFAULT_DND };
  if (obj.dnd && typeof obj.dnd === 'object') {
    const d = obj.dnd as Record<string, unknown>;
    dnd = {
      enabled: typeof d.enabled === 'boolean' ? d.enabled : DEFAULT_DND.enabled,
      start: typeof d.start === 'string' ? d.start : DEFAULT_DND.start,
      end: typeof d.end === 'string' ? d.end : DEFAULT_DND.end,
    };
  }
  return { events, methods, frequency, dnd };
}

/** Load preferences from localStorage with validation and fallback to defaults. */
export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };
    const parsed = JSON.parse(raw) as unknown;
    return validatePreferences(parsed);
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

/** Save preferences to localStorage. Best-effort; errors are swallowed. */
export function saveNotificationPreferences(prefs: NotificationPreferences): void {
  try {
    const validated = validatePreferences(prefs);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
  } catch {
    // localStorage may be full or disabled
  }
}

/** Returns true if a notification should be sent now for the given event/method. Loads prefs from storage. */
export function shouldNotify(
  eventType: NotificationEventKey,
  method: NotificationMethod,
  now?: Date
): boolean {
  const prefs = loadNotificationPreferences();
  if (prefs.frequency === 'off') return false;
  if (prefs.frequency === 'daily' || prefs.frequency === 'weekly') return false;
  if (isInDoNotDisturbWindow(prefs.dnd, now)) return false;
  const eventEnabled = prefs.events[eventType] !== false;
  if (!eventEnabled) return false;
  const methodEnabled = prefs.methods[method] === true;
  if (!methodEnabled) return false;
  return true;
}

// ---- Browser Notification API ----

/** Whether the Notification API is available. */
export function browserNotificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** Current permission: "default" | "granted" | "denied". */
export function getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!browserNotificationsSupported()) return 'unsupported';
  return Notification.permission;
}

/** Request browser notification permission. Returns the resulting permission. */
export async function requestBrowserNotificationPermission(): Promise<NotificationPermission | 'unsupported'> {
  if (!browserNotificationsSupported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  return perm;
}

/** Send a browser notification. No-op if unsupported or permission denied. */
export function sendBrowserNotification(title: string, options?: NotificationOptions): void {
  if (!browserNotificationsSupported() || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(title, options);
    n.onclick = () => {
      n.close();
      if (typeof window !== 'undefined' && window.focus) window.focus();
    };
    // Auto-close after ~4s to avoid clutter
    setTimeout(() => n.close(), 4000);
  } catch {
    // ignore
  }
}

// ---- Digest helpers (best-effort, in-memory) ----

export interface DigestEvent {
  eventType: NotificationEventKey;
  message: string;
  timestamp: string; // ISO
}

const digestQueue: DigestEvent[] = [];

const DIGEST_SENT_KEY = 'vaultdao_notification_digest_sent';

/** Enqueue an event for digest delivery. */
export function enqueueDigestEvent(event: DigestEvent): void {
  digestQueue.push(event);
}

/** Get summary of queued events for digest. Clears queue. */
export function getDigestSummary(): DigestEvent[] {
  const copy = [...digestQueue];
  digestQueue.length = 0;
  return copy;
}

/** Clear digest queue without consuming. */
export function clearDigestQueue(): void {
  digestQueue.length = 0;
}

/** Whether it's time to send a digest based on frequency and last sent. */
export function shouldSendDigestNow(
  frequency: NotificationFrequency,
  lastSentAt: string | null
): boolean {
  if (frequency !== 'daily' && frequency !== 'weekly') return false;
  const now = new Date();
  if (!lastSentAt) return true;
  const last = new Date(lastSentAt);
  if (Number.isNaN(last.getTime())) return true;
  if (frequency === 'daily') {
    const diff = now.getTime() - last.getTime();
    return diff >= 24 * 60 * 60 * 1000;
  }
  if (frequency === 'weekly') {
    const diff = now.getTime() - last.getTime();
    return diff >= 7 * 24 * 60 * 60 * 1000;
  }
  return false;
}

/** Persist that a digest was just sent. */
export function markDigestSentNow(): string {
  const iso = new Date().toISOString();
  try {
    localStorage.setItem(DIGEST_SENT_KEY, iso);
  } catch {
    // ignore
  }
  return iso;
}

/** Load last digest sent timestamp. */
export function getLastDigestSentAt(): string | null {
  try {
    return localStorage.getItem(DIGEST_SENT_KEY);
  } catch {
    return null;
  }
}
