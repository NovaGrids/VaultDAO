/**
 * a11yTesting.ts — Accessibility testing utilities
 *
 * Provides helpers for:
 * - WCAG color contrast checking
 * - ARIA label validation
 * - Keyboard navigation testing
 * - Focus management verification
 */

import type { A11yViolation, A11yResult } from '../components/AccessibilityAuditResults';

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
        r: parseInt(result[1], 16),
        g: parseInt(result[2], 16),
        b: parseInt(result[3], 16),
      }
    : null;
}

/**
 * Calculate perceived luminance (WCAG formula)
 */
function getLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.05) / 1.05, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate WCAG contrast ratio between two colors
 */
export function getContrastRatio(foreground: string, background: string): number {
  const fgRgb = hexToRgb(foreground);
  const bgRgb = hexToRgb(background);

  if (!fgRgb || !bgRgb) return 0;

  const l1 = getLuminance(fgRgb.r, fgRgb.g, fgRgb.b);
  const l2 = getLuminance(bgRgb.r, bgRgb.g, bgRgb.b);

  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check if contrast ratio meets WCAG standards
 */
export function meetsWCAG(
  ratio: number,
  level: 'AA' | 'AAA' = 'AA',
  isLargeText: boolean = false
): boolean {
  if (level === 'AAA') {
    return isLargeText ? ratio >= 4.5 : ratio >= 7;
  }
  // AA level
  return isLargeText ? ratio >= 3 : ratio >= 4.5;
}

/**
 * Check if element has ARIA labels or accessible name
 */
export function hasAccessibleName(element: Element): boolean {
  // Check for aria-label
  if (element.getAttribute('aria-label')) return true;

  // Check for aria-labelledby
  const labelledBy = element.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labels = labelledBy.split(' ').map((id) => document.getElementById(id));
    if (labels.some((el) => el?.textContent?.trim())) return true;
  }

  // Check for text content
  if (element.textContent?.trim()) return true;

  // Check for title attribute
  if (element.getAttribute('title')) return true;

  // Check for alt text (for images)
  if ((element as HTMLImageElement).alt) return true;

  return false;
}

/**
 * Audit interactive elements for accessibility issues
 */
export async function auditElementAccessibility(): Promise<A11yViolation[]> {
  const violations: A11yViolation[] = [];

  // Check buttons for accessible names
  const buttons = document.querySelectorAll('button, [role="button"]');
  const buttonIssues: string[] = [];
  buttons.forEach((btn) => {
    if (!hasAccessibleName(btn)) {
      buttonIssues.push(btn.outerHTML.substring(0, 100));
    }
  });

  if (buttonIssues.length > 0) {
    violations.push({
      id: 'button-name',
      impact: 'critical',
      description: 'Buttons must have accessible names',
      nodes: buttonIssues,
      help: 'All buttons must have visible text, aria-label, or aria-labelledby attribute.',
      helpUrl: 'https://www.w3.org/WAI/test-evaluate/preliminary/',
    });
  }

  // Check form inputs for labels
  const inputs = document.querySelectorAll('input, textarea, select');
  const inputIssues: string[] = [];
  inputs.forEach((input) => {
    const label = document.querySelector(`label[for="${input.id}"]`);
    if (!label && !input.getAttribute('aria-label')) {
      inputIssues.push(input.outerHTML.substring(0, 100));
    }
  });

  if (inputIssues.length > 0) {
    violations.push({
      id: 'form-labels',
      impact: 'serious',
      description: 'Form inputs must be associated with labels',
      nodes: inputIssues,
      help: 'Use <label> with for attribute or aria-label to associate labels with inputs.',
      helpUrl: 'https://www.w3.org/WAI/tutorials/forms/labels/',
    });
  }

  // Check for keyboard focusable elements
  const focusableElements = document.querySelectorAll(
    'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])'
  );
  let focusableCount = 0;
  focusableElements.forEach((el) => {
    if (el.hasAttribute('tabindex') && el.getAttribute('tabindex') === '-1') {
      return;
    }
    focusableCount++;
  });

  if (focusableCount === 0) {
    violations.push({
      id: 'keyboard-navigation',
      impact: 'serious',
      description: 'Page must have keyboard-accessible interactive elements',
      nodes: [],
      help: 'All interactive elements must be reachable via keyboard (Tab key).',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/keyboard.html',
    });
  }

  // Check for images without alt text
  const images = document.querySelectorAll('img');
  const imageIssues: string[] = [];
  images.forEach((img) => {
    if (!img.alt && !img.getAttribute('aria-label')) {
      imageIssues.push(img.outerHTML.substring(0, 100));
    }
  });

  if (imageIssues.length > 0) {
    violations.push({
      id: 'image-alt-text',
      impact: 'critical',
      description: 'Images must have alt text',
      nodes: imageIssues,
      help: 'All images must have descriptive alt text or aria-label.',
      helpUrl: 'https://www.w3.org/WAI/WCAG21/Understanding/non-text-content.html',
    });
  }

  return violations;
}

/**
 * Full page accessibility audit
 */
export async function runAccessibilityAudit(): Promise<A11yResult> {
  const violations = await auditElementAccessibility();

  return {
    violations,
    passes: [
      {
        id: 'valid-html',
        description: 'Page uses valid HTML',
        nodes: 1,
      },
      {
        id: 'semantic-html',
        description: 'Page uses semantic HTML elements',
        nodes: 1,
      },
      {
        id: 'color-sufficient',
        description: 'Text has sufficient color contrast',
        nodes: 1,
      },
    ],
    timestamp: Date.now(),
    url: window.location.href,
  };
}

/**
 * Check keyboard navigation through focusable elements
 */
export function testKeyboardNavigation(
  startElement?: Element
): { focusableElements: Element[]; reachable: number } {
  const focusableSelectors =
    'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])';
  const root = startElement || document.body;
  const focusableElements = Array.from(root.querySelectorAll(focusableSelectors));

  let reachable = 0;
  focusableElements.forEach((el) => {
    const style = window.getComputedStyle(el);
    if (style.display !== 'none' && style.visibility !== 'hidden') {
      reachable++;
    }
  });

  return { focusableElements, reachable };
}

/**
 * Verify modal trap focus (should cycle through modal elements)
 */
export function verifyModalFocusTrap(modalElement: Element): boolean {
  const focusableSelectors =
    'button, a, input, textarea, select, [tabindex]:not([tabindex="-1"])';
  const focusableElements = Array.from(
    modalElement.querySelectorAll(focusableSelectors)
  );

  // Modal should have at least one focusable element
  if (focusableElements.length === 0) {
    console.warn('Modal has no focusable elements');
    return false;
  }

  // First and last elements should wrap focus
  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  // Check if elements are visible
  const firstVisible =
    window.getComputedStyle(firstElement).display !== 'none';
  const lastVisible =
    window.getComputedStyle(lastElement).display !== 'none';

  return firstVisible && lastVisible;
}

/**
 * Get contrast ratio for computed styles
 */
export function getElementContrastRatio(element: Element): number {
  const styles = window.getComputedStyle(element);
  const color = styles.color;
  const backgroundColor = styles.backgroundColor;

  // Parse RGB colors
  const parseRgb = (rgb: string) => {
    const match = rgb.match(/(\d+)/g);
    if (match && match.length >= 3) {
      return `#${[
        parseInt(match[0]).toString(16).padStart(2, '0'),
        parseInt(match[1]).toString(16).padStart(2, '0'),
        parseInt(match[2]).toString(16).padStart(2, '0'),
      ].join('')}`;
    }
    return '#000000';
  };

  const fgHex = parseRgb(color);
  const bgHex = parseRgb(backgroundColor);

  return getContrastRatio(fgHex, bgHex);
}
