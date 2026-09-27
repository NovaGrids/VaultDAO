import { describe, it, expect, beforeEach } from 'vitest';
import {
  getContrastRatio,
  meetsWCAG,
  hasAccessibleName,
} from '../a11yTesting';

describe('a11yTesting', () => {
  describe('getContrastRatio', () => {
    it('should calculate contrast ratio between colors', () => {
      // Black on white should have highest contrast
      const ratio = getContrastRatio('#FFFFFF', '#000000');
      expect(ratio).toBeGreaterThan(20);
    });

    it('should return 0 for invalid colors', () => {
      const ratio = getContrastRatio('invalid', '#000000');
      expect(ratio).toBe(0);
    });

    it('should calculate WCAG AA compliant ratio', () => {
      // Dark gray on white = ~13:1 (exceeds AA requirement of 4.5:1)
      const ratio = getContrastRatio('#FFFFFF', '#333333');
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });

    it('should calculate WCAG AAA compliant ratio', () => {
      // Black on white = ~21:1 (exceeds AAA requirement of 7:1)
      const ratio = getContrastRatio('#FFFFFF', '#000000');
      expect(ratio).toBeGreaterThanOrEqual(7);
    });

    it('should handle insufficient contrast', () => {
      // Light gray on white = low contrast
      const ratio = getContrastRatio('#FFFFFF', '#EEEEEE');
      expect(ratio).toBeLessThan(4.5);
    });
  });

  describe('meetsWCAG', () => {
    it('should verify AA level compliance for normal text', () => {
      expect(meetsWCAG(4.5, 'AA', false)).toBe(true);
      expect(meetsWCAG(4.49, 'AA', false)).toBe(false);
    });

    it('should verify AA level compliance for large text', () => {
      expect(meetsWCAG(3, 'AA', true)).toBe(true);
      expect(meetsWCAG(2.99, 'AA', true)).toBe(false);
    });

    it('should verify AAA level compliance for normal text', () => {
      expect(meetsWCAG(7, 'AAA', false)).toBe(true);
      expect(meetsWCAG(6.99, 'AAA', false)).toBe(false);
    });

    it('should verify AAA level compliance for large text', () => {
      expect(meetsWCAG(4.5, 'AAA', true)).toBe(true);
      expect(meetsWCAG(4.49, 'AAA', true)).toBe(false);
    });
  });

  describe('hasAccessibleName', () => {
    let container: HTMLElement;

    beforeEach(() => {
      container = document.createElement('div');
      document.body.appendChild(container);
    });

    afterEach(() => {
      document.body.removeChild(container);
    });

    it('should detect aria-label', () => {
      const button = document.createElement('button');
      button.setAttribute('aria-label', 'Close');
      container.appendChild(button);

      expect(hasAccessibleName(button)).toBe(true);
    });

    it('should detect text content', () => {
      const button = document.createElement('button');
      button.textContent = 'Submit';
      container.appendChild(button);

      expect(hasAccessibleName(button)).toBe(true);
    });

    it('should detect title attribute', () => {
      const button = document.createElement('button');
      button.setAttribute('title', 'Submit form');
      button.innerHTML = '<span style="display:none;">x</span>';
      container.appendChild(button);

      expect(hasAccessibleName(button)).toBe(true);
    });

    it('should detect alt text for images', () => {
      const img = document.createElement('img');
      img.src = 'test.png';
      img.alt = 'Test image';
      container.appendChild(img);

      expect(hasAccessibleName(img)).toBe(true);
    });

    it('should detect aria-labelledby', () => {
      const label = document.createElement('div');
      label.id = 'label-1';
      label.textContent = 'Label text';
      container.appendChild(label);

      const button = document.createElement('button');
      button.setAttribute('aria-labelledby', 'label-1');
      container.appendChild(button);

      expect(hasAccessibleName(button)).toBe(true);
    });

    it('should return false for elements without accessible names', () => {
      const button = document.createElement('button');
      container.appendChild(button);

      expect(hasAccessibleName(button)).toBe(false);
    });

    it('should ignore whitespace-only text content', () => {
      const button = document.createElement('button');
      button.textContent = '   ';
      container.appendChild(button);

      expect(hasAccessibleName(button)).toBe(false);
    });
  });
});
