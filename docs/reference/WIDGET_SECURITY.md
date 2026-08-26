# Widget SDK Sandbox Security Model

VaultDAO allows third-party widgets to run inside the dashboard through `WidgetSandbox.tsx` and `WidgetSDK.ts`. Because the dashboard has direct access to live vault proposals and can trigger UI actions, the sandbox boundary between host and widget code is a trust boundary that must be understood clearly.

This document describes exactly how that boundary works, what a widget can and cannot do, the postMessage protocol that crosses it, the permission model, the review criteria for third-party widgets, and the threat model for adversarial widget scenarios.

---

## Table of Contents

1. [Sandbox Architecture Overview](#1-sandbox-architecture-overview)
2. [iframe Sandbox Attribute and CSP Rules](#2-iframe-sandbox-attribute-and-csp-rules)
3. [postMessage Protocol](#3-postmessage-protocol)
4. [Permission Model](#4-permission-model)
5. [Allowed APIs](#5-allowed-apis)
6. [Origin Validation and Message Routing](#6-origin-validation-and-message-routing)
7. [Widget Manifest and Validation](#7-widget-manifest-and-validation)
8. [Widget Review Process](#8-widget-review-process)
9. [Threat Model](#9-threat-model)
10. [Known Limitations and Planned Hardening](#10-known-limitations-and-planned-hardening)

---

## 1. Sandbox Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  VaultDAO Dashboard (host window)                           │
│                                                             │
│  WidgetSandbox.tsx                                          │
│  ├── window.addEventListener('message', handleMessage)      │
│  ├── validates: event.source === iframe.contentWindow       │
│  ├── validates: message.widgetId === widget.id              │
│  └── dispatches to handler (config / data / action)        │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  <iframe sandbox="allow-scripts"                     │  │
│  │          src={blob: URL}>                            │  │
│  │                                                       │  │
│  │  Widget code (third-party JS)                        │  │
│  │  ├── WidgetSDK (window.parent.postMessage)           │  │
│  │  └── has NO access to host DOM, cookies, storage     │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

Widget code runs inside a cross-origin `<iframe>` whose `src` is a `blob:` URL generated at render time. The blob URL is same-origin with `null` (the browser treats `blob:` iframes as opaque-origin when combined with `sandbox`), which means widget code cannot read the host page's cookies, localStorage, IndexedDB, or DOM.

All capability requests from widget to host must go through the postMessage bridge. The host never grants capabilities the widget did not explicitly declare in its manifest and that the user did not approve.

---

## 2. iframe Sandbox Attribute and CSP Rules

### Sandbox attribute

The iframe is rendered with:

```tsx
<iframe
  sandbox="allow-scripts"
  src={blobUrl}
  title={widget.metadata.name}
/>
```

**`allow-scripts`** is the only token present. The following capabilities are explicitly withheld:

| Omitted token | Effect |
|---|---|
| `allow-same-origin` | The iframe has an opaque origin. It cannot access host cookies, storage, or call same-origin APIs. |
| `allow-forms` | Form submissions are blocked. |
| `allow-popups` | `window.open()` and `<a target="_blank">` are blocked. |
| `allow-top-navigation` | The widget cannot redirect the top-level page. |
| `allow-downloads` | File downloads are blocked. |
| `allow-modals` | `alert()`, `confirm()`, `prompt()` are blocked. |
| `allow-pointer-lock` | Pointer lock API is blocked. |
| `allow-presentation` | Presentation API is blocked. |

The absence of `allow-same-origin` is the most important constraint. Even though scripts can run, the iframe treats itself as a cross-origin document with null origin, so it cannot read or write any storage that belongs to the host.

### Blob URL as the content delivery mechanism

Widget content is injected as an inline `blob:` URL built from a static HTML template inside `loadWidget()`. In production, the template wraps the widget's declared `entryPoint` with a script-module import. Because the blob is constructed server-side (at render time), there is no external URL fetch that could be MITMed to swap content.

> **Note:** the Content Security Policy (CSP) for the host page should include `frame-src blob:` to allow this pattern, and should restrict `frame-src` to `blob:` only so that iframes cannot load arbitrary external URLs.

---

## 3. postMessage Protocol

All communication between the widget and the host uses `window.postMessage`. The message shape is defined in `src/types/widget.ts`:

```ts
interface WidgetMessage {
  type: 'init' | 'config' | 'data' | 'action' | 'error' | 'event'
      | 'response' | 'config-response' | 'data-response' | 'permission-response';
  payload: unknown;
  callId?: string;   // correlates requests to responses
  widgetId: string;  // identifies the widget instance
}
```

### Widget → Host messages (requests)

| `type` | `payload.action` | Description |
|---|---|---|
| `init` | — | Widget signals it is ready. Clears loading state. |
| `config` | `get` | Request current widget settings. |
| `config` | `set` | Persist updated settings. |
| `data` | `getProposals` | Fetch current proposal list. |
| `data` | `getVaultConfig` | Fetch on-chain vault configuration. |
| `action` | `showToast` | Display a notification banner. Requires `notifications` permission. |
| `action` | `navigate` | Navigate the host app to a path. |
| `action` | `subscribe` | Subscribe to a named vault event. |
| `action` | `unsubscribe` | Unsubscribe from a named vault event. |
| `action` | `request-permission` | Ask the host to grant a permission at runtime. |
| `action` | `notify` | Send a notification via the host. Requires `notifications` permission. |
| `error` | — | Widget reports its own error to the host. |

### Host → Widget messages (responses and events)

| `type` | When sent |
|---|---|
| `response` | Correlated reply to any request that included a `callId`. |
| `config-response` | Legacy reply to a `config/get` request. |
| `data-response` | Legacy reply to a `data` request. |
| `permission-response` | Reply to a `request-permission` action. |
| `event` | Pushed by the host when a subscribed `WidgetEventType` fires. |
| `error` | Host error forwarded to the widget. |

### Call/response correlation

The `WidgetSDK.request()` method generates a random `callId` for each request:

```ts
const callId = Math.random().toString(36).substring(2, 11);
```

The pending promise is stored in `pendingRequests` keyed by `callId` and rejected after a **30-second timeout** to prevent indefinite leaks. The host echoes the `callId` back in the `response` message so the SDK can resolve the correct promise.

> **Security note:** `callId` values are randomly generated but are not cryptographically strong (`Math.random()`). They provide correlation, not authentication. Origin validation (see §6) is what prevents a rogue frame from injecting fake responses.

### Subscribable vault events

```ts
type WidgetEventType =
  | 'proposalCreated'
  | 'proposalUpdated'
  | 'vaultConfigChanged'
  | 'balanceChanged';
```

The host only pushes events to a widget after the widget has explicitly subscribed via `action/subscribe`. Events are pushed to the specific widget's `contentWindow` only.

---

## 4. Permission Model

Permissions are declared in the widget manifest and evaluated at install time. The host enforces each permission independently — the widget SDK also performs client-side checks, but the host-side check in `WidgetSandbox.tsx` is the authoritative gate.

```ts
interface WidgetPermissions {
  network?:        boolean;  // call getData() / external data fetches via host
  storage?:        boolean;  // persist widget settings via the host's config store
  wallet?:         boolean;  // reserved — not yet connected to Freighter
  notifications?:  boolean;  // showToast() and sendNotification()
}
```

### Host-side enforcement (authoritative)

| Action | Check in WidgetSandbox |
|---|---|
| `showToast` | `widget.permissions.notifications === true` |
| `notify` | `widget.permissions.notifications === true` |

Any action that requires a permission and does not pass the host check receives `{ error: '<permission> permission denied' }` as the response. The widget's JavaScript is never executed on the host side; only the response is denied.

### SDK-side enforcement (defence-in-depth)

`WidgetSDK` checks permissions before calling `postMessage` for:

- `getData()` — requires `network`
- `showToast()` — requires `notifications`
- `sendNotification()` — requires `notifications`

This catches misconfigured widgets early and produces a clear error message, but it is not a security boundary because widget code can bypass its own SDK.

### Permission escalation at runtime

A widget may call `requestPermission(permission)` to ask the user to grant an additional permission. The current implementation in the sandbox mock-grants every runtime permission request (`respond(true)`). Before production, this must be replaced with a user-facing confirmation dialog.

---

## 5. Allowed APIs

These are the capabilities the bridge exposes. Anything not listed here is not accessible to widget code.

### Read-only data

| API | Data returned | Notes |
|---|---|---|
| `getConfig()` | Widget's own persisted settings object | Scoped to this widget's `id` |
| `getProposals()` | Current in-memory proposal list from `useProposals()` hook | Read-only snapshot |
| `getVaultConfig()` | On-chain vault config from `useVaultContract()` | Read-only |
| `getData(key)` | Arbitrary data by key via host data layer | Requires `network` permission |

### UI actions

| API | Effect | Permission required |
|---|---|---|
| `showToast(msg, type)` | Displays a toast notification | `notifications` |
| `sendNotification(msg)` | Sends a notification via host | `notifications` |
| `navigate(path)` | Calls React Router `navigate()` | None (any widget) |

### Configuration

| API | Effect | Notes |
|---|---|---|
| `setConfig(config)` | Logs updated settings (persistence not yet wired) | Does not write on-chain |

### Events

| API | Effect |
|---|---|
| `onEvent(type, handler)` | Subscribe to a `WidgetEventType`; host starts pushing events |
| `offEvent(type, handler)` | Unsubscribe; host stops pushing if no other handlers remain |

### What widgets cannot do

- Read, write, or delete the host page's DOM.
- Access the user's Freighter wallet private key or sign transactions. (`wallet` permission is reserved and has no backend wiring.)
- Make arbitrary network requests from the host origin. (`getData` is proxied through the host; widgets cannot use `fetch` to call the host's own APIs because they run as a null-origin iframe.)
- Access `localStorage`, `sessionStorage`, cookies, or IndexedDB belonging to the VaultDAO host origin.
- Open new windows or tabs.
- Submit forms.

---

## 6. Origin Validation and Message Routing

### Inbound validation in `WidgetSandbox.tsx`

Every message received by the host goes through two checks before being processed:

```ts
// Check 1: message came from our specific iframe, not any other frame
if (event.source !== iframeRef.current?.contentWindow) return;

// Check 2: message carries the correct widget ID for this sandbox instance
if (message.widgetId !== widget.id) return;
```

This means:

- A widget running in one sandbox cannot spoof messages from another widget.
- An external page that opens the host in a frame cannot inject messages into the bridge.
- Forge-ability is limited to the iframe itself. Since widget code runs in a null-origin sandbox with `allow-scripts` only, it has no persistent mechanism to exfiltrate data.

### Outbound target origin

Both the host and the widget SDK currently use `'*'` as the `targetOrigin` argument to `postMessage`:

```ts
// WidgetSandbox.tsx — host sending to widget
iframeRef.current?.contentWindow?.postMessage({ ... }, '*');

// WidgetSDK.ts — widget sending to host
window.parent.postMessage({ ... }, '*');
```

Using `'*'` on outbound messages is a known weakness (see §10). Because the iframe has a null origin, specifying an explicit targetOrigin of `'null'` or the host's real origin would be the correct fix.

---

## 7. Widget Manifest and Validation

Every installable widget must provide a manifest that passes `WidgetUtils.validateManifest()`:

```ts
interface WidgetManifest {
  metadata: {
    id: string;       // globally unique, slug format recommended
    name: string;
    version: string;  // semver
    author: string;
    description: string;
    category: WidgetCategory;
    source: WidgetSource;
    tags: string[];
    createdAt: string;
    updatedAt: string;
  };
  permissions: WidgetPermissions;
  entryPoint: string;     // URL or inline JS entry point
  configSchema?: Record<string, any>;
}
```

The validator (`validateManifest`) checks that `metadata.id`, `metadata.name`, `metadata.version`, `metadata.author`, and `entryPoint` are all present. Manifests missing any of these fields are rejected at install time.

---

## 8. Widget Review Process

The following criteria apply to all third-party widgets submitted to the VaultDAO marketplace. Built-in widgets (`source: 'built-in'`) are reviewed as part of the normal PR process.

### Submission requirements

1. **Manifest completeness** — all required fields populated, `version` follows semver.
2. **Minimal permissions** — request only the permissions actually needed. Requesting `wallet` without documented rationale will be rejected.
3. **No external network calls from widget code** — widgets must proxy all data access through the `getData()` SDK method rather than calling external APIs directly from the iframe (which would expose the user's IP/fingerprint to third-party servers without consent).
4. **Static entry point** — the `entryPoint` must point to a stable, versioned URL (or inline code). Widgets that load dynamic scripts at runtime (e.g. `import(unknownUrl)`) will be rejected.
5. **No DOM-escaping techniques** — using `document.domain`, `postMessage` flooding, prototype pollution, or other sandbox escape techniques is grounds for immediate removal and a permanent ban.

### Review checklist

- [ ] Manifest validates against `validateManifest()`
- [ ] Permissions declared are the minimum required
- [ ] `entryPoint` is a versioned, auditable URL or inlined bundle
- [ ] Widget does not make external `fetch` calls from within the iframe
- [ ] Widget does not attempt to access `window.top`, `window.parent` beyond the SDK postMessage interface
- [ ] `WidgetUtils.sanitizeHTML()` or equivalent is used before any dynamic HTML injection inside the widget
- [ ] No `eval()`, `Function()` constructor, or dynamic `import()` of remote code
- [ ] Reviewed by at least one VaultDAO maintainer with a signed approval comment on the PR

### Verified badge

Widgets that have passed review and are hosted on infrastructure controlled by the VaultDAO team receive the `verified: true` flag in the `MarketplaceWidget` record. Unverified widgets display a warning in the `WidgetMarketplace.tsx` UI.

---

## 9. Threat Model

### Assets at risk

| Asset | Risk level | Notes |
|---|---|---|
| On-chain funds | **Low** | Widget code cannot sign transactions. `wallet` permission has no current backend. |
| Proposal data | **Medium** | Widgets with `getProposals` access can read current in-memory proposals. |
| Vault configuration | **Medium** | `getVaultConfig()` exposes on-chain settings. |
| User navigation | **Low** | `navigate()` can redirect within the SPA but cannot leave the host domain. |
| Notification spam | **Low-Medium** | A widget with `notifications` permission could spam the UI. Rate limiting is not yet implemented. |
| Host origin cookies / storage | **Low** | Blocked by null-origin sandbox + absence of `allow-same-origin`. |

### Threat scenarios

#### T1 — Malicious widget reads proposal data and exfiltrates it

**Vector:** A widget calls `getProposals()` and `getVaultConfig()` legitimately (no permission gate on these), then sends the data to an external server via `fetch()` from inside the iframe.

**Mitigations in place:**
- The iframe runs as null-origin. `fetch()` calls from inside will include a null `Origin` header. Most servers reject null-origin CORS requests.
- The host's own CSP can add `connect-src` restrictions to the host page, but this does not restrict the iframe's own fetch calls.

**Residual risk:** A malicious widget CAN make outbound fetch calls to a server configured to accept null-origin requests. Proposal and vault config data would be exposed.

**Recommended hardening:** Add a host-level CSP `frame-src blob:` policy combined with iframe-level CSP headers on the blob response (not yet feasible with blob URLs, but achievable by switching to a dedicated sandboxed subdomain).

---

#### T2 — Malicious widget injects code into the host DOM via postMessage flooding

**Vector:** The widget floods the bridge with `action/showToast` messages to degrade dashboard UX, or attempts to find message-handling bugs in the host.

**Mitigations in place:**
- Every message is validated against `event.source` (iframe identity) and `widgetId`.
- `showToast` requires the `notifications` permission to be granted.

**Residual risk:** A widget with `notifications` permission could spam toasts. No rate limiting is currently implemented on `showToast` calls.

**Recommended hardening:** Add per-widget rate limiting in `handleWidgetAction` (e.g., max 5 toasts per 10 seconds).

---

#### T3 — Malicious widget attempts sandbox escape via `allow-scripts`

**Vector:** A widget tries to break out of the iframe using browser vulnerabilities or JavaScript prototype pollution to gain access to the host window.

**Mitigations in place:**
- `allow-same-origin` is absent, making the iframe a null-origin document. Browser-level isolation applies.
- The iframe cannot directly access `document.cookie`, `localStorage`, or the host DOM tree.

**Residual risk:** Depends entirely on browser security. A zero-day in the browser's iframe isolation would not be mitigated at the application layer. This is accepted risk for all web applications.

---

#### T4 — Compromised widget supply chain (CDN / entryPoint URL hijack)

**Vector:** A third-party widget's `entryPoint` URL is served from a CDN that gets compromised. The updated script runs in the sandbox and exfiltrates data.

**Mitigations in place:**
- Review checklist requires `entryPoint` to be versioned and auditable.
- `verified: true` badge signals maintainer review.

**Residual risk:** Once installed, a widget's entry point is not re-validated on every render. A hijacked CDN could serve malicious code that bypasses the review gate.

**Recommended hardening:** Pin `entryPoint` to a subresource integrity (SRI) hash stored in the manifest, and verify the hash before injecting the script blob.

---

#### T5 — Widget spoofs another widget's messages

**Vector:** A malicious widget crafts a postMessage with a different `widgetId` to steal another widget's config or impersonate it.

**Mitigations in place:**
- The host checks `event.source !== iframeRef.current?.contentWindow`. Only messages from the specific iframe pass. A widget in sandbox A cannot pass messages that satisfy the `event.source` check for sandbox B.

**Residual risk:** None within the current architecture, assuming each `WidgetSandbox` component holds a separate `iframeRef`.

---

#### T6 — Malicious widget navigates user to a phishing path

**Vector:** A widget calls `navigate('/login')` or a custom path that renders a phishing overlay.

**Mitigations in place:**
- `navigate()` calls React Router's `navigate()`, which is restricted to routes defined in the host's router. It cannot navigate to external URLs.
- The host's router rejects unknown paths.

**Residual risk:** If a widget navigates to a legitimate-looking path that was improperly accessible without authentication, the user could be led there. This is mitigated by proper route-level auth guards in the host application, not the sandbox.

---

#### T7 — Untrusted postMessage from external page (cross-frame attack)

**Vector:** A third-party page embeds the VaultDAO dashboard in its own iframe and posts crafted messages to the host's `window.addEventListener('message', ...)`.

**Mitigations in place:**
- The `event.source !== iframeRef.current?.contentWindow` check requires the message to originate from the specific sandbox iframe, not any arbitrary frame.

**Residual risk:** If an attacker can load VaultDAO inside their own iframe (i.e., VaultDAO lacks `X-Frame-Options: DENY` or `Content-Security-Policy: frame-ancestors 'none'`), they could compose attacks that require only the `message` listener — but the `event.source` check blocks message injection. The main residual risk is clickjacking; ensure VaultDAO's server headers include `X-Frame-Options: DENY`.

---

## 10. Known Limitations and Planned Hardening

The following gaps exist in the current implementation and should be addressed before production third-party widget support is enabled.

| # | Issue | Current state | Recommended fix |
|---|---|---|---|
| L1 | `targetOrigin: '*'` on outbound postMessage | Both host and SDK use `'*'` | Host should use the iframe's origin; SDK should use the host's exact origin. |
| L2 | `callId` uses `Math.random()` | Not cryptographically random | Replace with `crypto.randomUUID()` |
| L3 | `request-permission` auto-grants | All runtime permission requests are accepted with `respond(true)` | Replace with a user confirmation dialog before granting. |
| L4 | No rate limiting on `showToast` / `notify` | Unlimited calls | Add per-widget throttle (e.g., 5 calls / 10 s). |
| L5 | No SRI pinning for `entryPoint` | Entry points are loaded as-is | Store SRI hash in manifest and verify before injection. |
| L6 | No dedicated sandboxed subdomain | Widgets run as blob-origin inside the main window | Serve widgets from `widgets.vaultdao.app` with its own CSP to further isolate network access. |
| L7 | `wallet` permission has no backend | Declared in types but not wired | Do not connect the `wallet` permission to Freighter until a full transaction review UI is implemented. |
| L8 | Proposals pushed on every render change | `proposalCreated` event fires whenever `proposals` state changes, not just new ones | Track last-seen proposal ID to emit events only for genuinely new proposals. |

---

*For contract-level security, see [SECURITY.md](SECURITY.md) and [AUDIT_SCOPE.md](AUDIT_SCOPE.md). For the overall architecture, see [ARCHITECTURE.md](ARCHITECTURE.md).*
