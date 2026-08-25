/**
 * Content Security Policy configuration — single source of truth.
 *
 * This module is intentionally free of Vite/esbuild imports so it can be
 * consumed by:
 *   1. vite.config.ts  → sets the HTTP header during dev and vite preview
 *   2. index.html      → the <meta http-equiv="Content-Security-Policy"> tag
 *   3. src/__tests__/csp.test.ts  → validates the policy at test time
 *
 * Directive rationale
 * ───────────────────
 * script-src 'unsafe-inline'
 *   Required for the no-flash theme init <script> in index.html.
 *   When the app migrates to SSR / a nonce-capable server, replace this with
 *   a per-request nonce.
 *
 * style-src 'unsafe-inline'
 *   Tailwind CSS injects utility styles at runtime in development.
 *
 * connect-src
 *   - Stellar Soroban RPC (testnet)
 *   - Stellar Horizon REST API (testnet)
 *   - stellar.expert block explorer (links / API calls)
 *   - wss: for the y-websocket collaboration server
 *
 * img-src data: blob:
 *   - data: for QR codes (qrcode.react) and chart SVG exports
 *   - blob: for html2canvas / PDF export Blob URLs
 *
 * worker-src blob:
 *   jsPDF and html2canvas spin up web workers from blob: URLs.
 *
 * object-src / base-uri / form-action / frame-ancestors
 *   Locked down to block plugin injection, base-tag hijacking,
 *   form exfiltration, and clickjacking.
 */

export const CSP_DIRECTIVES: string[] = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  [
    "connect-src 'self'",
    'https://soroban-testnet.stellar.org',
    'https://horizon-testnet.stellar.org',
    'https://stellar.expert',
    'wss:',
  ].join(' '),
  "worker-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

/** Full policy string — ready to use as an HTTP header value or meta content. */
export const CSP_POLICY: string = CSP_DIRECTIVES.join('; ');
