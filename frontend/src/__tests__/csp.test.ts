/**
 * CSP validation tests – #1618
 *
 * These tests verify that:
 *  1. index.html contains a <meta http-equiv="Content-Security-Policy"> tag.
 *  2. The meta-tag policy is structurally identical to the CSP_POLICY constant
 *     exported from vite.config.ts (single source of truth).
 *  3. Every required directive and allowed origin is present.
 *  4. Dangerous / missing directives (object-src, base-uri, frame-ancestors)
 *     are locked down, not left open.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── helpers ─────────────────────────────────────────────────────────────────

const INDEX_HTML_PATH = resolve(__dirname, '../../index.html');

function readIndexHtml(): string {
  return readFileSync(INDEX_HTML_PATH, 'utf-8');
}

/**
 * Extract the policy string from the <meta http-equiv="Content-Security-Policy">
 * tag in index.html.
 *
 * The tag may span multiple lines, so we split the HTML into individual meta
 * elements and find the one with the CSP http-equiv attribute.
 */
function extractMetaCsp(html: string): string {
  // Split into individual <meta … > blocks so we don't greedily match across tags.
  const metaBlocks = html.match(/<meta[\s\S]*?>/gi) ?? [];
  const cspBlock = metaBlocks.find((block) =>
    /http-equiv=["']Content-Security-Policy["']/i.test(block),
  );
  if (!cspBlock) throw new Error('CSP meta tag not found in index.html');

  // Pull the content attribute value out of the element.
  const contentMatch = cspBlock.match(/content=["']([\s\S]*?)["']\s*\//i)
    ?? cspBlock.match(/content=["']([\s\S]*?)["']/i);
  if (!contentMatch) throw new Error('CSP meta tag has no content attribute');

  return normalisePolicy(contentMatch[1]);
}

/**
 * Collapse whitespace within a policy string so comparisons are robust to
 * formatting differences (newlines, multiple spaces, etc.).
 */
function normalisePolicy(policy: string): string {
  return policy
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/;\s*/g, '; ')
    .replace(/;\s*$/, ''); // strip any trailing semicolon (with or without spaces)
}

/**
 * Parse a normalised CSP string into a Map of directive-name → directive-value.
 */
function parseDirectives(policy: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of policy.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) {
      map.set(trimmed.toLowerCase(), '');
    } else {
      map.set(
        trimmed.slice(0, spaceIdx).toLowerCase(),
        trimmed.slice(spaceIdx + 1).trim(),
      );
    }
  }
  return map;
}

// ── import the canonical policy ──────────────────────────────────────────────

// Import directly from the dedicated CSP module — this avoids pulling in
// vite/esbuild which trigger a TextEncoder invariant failure in jsdom.
import { CSP_POLICY } from '../config/csp';

// ── tests ────────────────────────────────────────────────────────────────────

describe('Content Security Policy', () => {
  describe('index.html meta tag', () => {
    it('has a <meta http-equiv="Content-Security-Policy"> tag', () => {
      const html = readIndexHtml();
      expect(html).toMatch(/http-equiv=["']Content-Security-Policy["']/i);
    });

    it('meta tag policy matches the CSP_POLICY constant from vite.config.ts', () => {
      const html = readIndexHtml();
      const metaPolicy = extractMetaCsp(html);
      const vitePolicy = normalisePolicy(CSP_POLICY);
      expect(metaPolicy).toBe(vitePolicy);
    });
  });

  describe('required directives', () => {
    let directives: Map<string, string>;

    beforeAll(() => {
      directives = parseDirectives(normalisePolicy(CSP_POLICY));
    });

    it("default-src is 'self'", () => {
      expect(directives.get('default-src')).toBe("'self'");
    });

    it("script-src includes 'self'", () => {
      expect(directives.get('script-src')).toContain("'self'");
    });

    it("script-src includes 'unsafe-inline' (required for theme init script)", () => {
      // This is intentional – the inline theme script cannot use a nonce
      // on a static HTML file served by Vite. Keep this note: when migrating
      // to SSR/a nonce-capable server, replace 'unsafe-inline' with a nonce.
      expect(directives.get('script-src')).toContain("'unsafe-inline'");
    });

    it('script-src does NOT include unsafe-eval', () => {
      expect(directives.get('script-src') ?? '').not.toContain('unsafe-eval');
    });

    it("style-src includes 'self'", () => {
      expect(directives.get('style-src')).toContain("'self'");
    });

    it('connect-src includes Stellar Soroban RPC endpoint', () => {
      expect(directives.get('connect-src')).toContain(
        'https://soroban-testnet.stellar.org',
      );
    });

    it('connect-src includes Stellar Horizon endpoint', () => {
      expect(directives.get('connect-src')).toContain(
        'https://horizon-testnet.stellar.org',
      );
    });

    it('connect-src includes stellar.expert explorer', () => {
      expect(directives.get('connect-src')).toContain('https://stellar.expert');
    });

    it('connect-src allows wss: for y-websocket collaboration', () => {
      expect(directives.get('connect-src')).toContain('wss:');
    });

    it('img-src allows data: URIs (QR codes, recharts)', () => {
      expect(directives.get('img-src')).toContain('data:');
    });

    it('img-src allows blob: (html2canvas / PDF export)', () => {
      expect(directives.get('img-src')).toContain('blob:');
    });

    it('worker-src allows blob: (jsPDF / canvas workers)', () => {
      expect(directives.get('worker-src')).toContain('blob:');
    });
  });

  describe('security-hardening directives', () => {
    let directives: Map<string, string>;

    beforeAll(() => {
      directives = parseDirectives(normalisePolicy(CSP_POLICY));
    });

    it("object-src is 'none' (blocks Flash/plugin injection)", () => {
      expect(directives.get('object-src')).toBe("'none'");
    });

    it("base-uri is 'self' (prevents base-tag hijacking)", () => {
      expect(directives.get('base-uri')).toBe("'self'");
    });

    it("form-action is 'self' (prevents form exfiltration)", () => {
      expect(directives.get('form-action')).toBe("'self'");
    });

    it("frame-ancestors is 'none' (prevents clickjacking)", () => {
      expect(directives.get('frame-ancestors')).toBe("'none'");
    });

    it('connect-src does NOT allow wildcard *', () => {
      expect(directives.get('connect-src') ?? '').not.toMatch(/(?:^|\s)\*(?:\s|$)/);
    });

    it('script-src does NOT allow wildcard *', () => {
      expect(directives.get('script-src') ?? '').not.toMatch(/(?:^|\s)\*(?:\s|$)/);
    });
  });
});
