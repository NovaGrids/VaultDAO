import { describe, it, expect } from 'vitest';
import { buildWidgetSandboxHtml, isValidWidgetId } from './widgetSandbox';

describe('isValidWidgetId', () => {
  it('accepts lowercase letters, digits and hyphens up to 64 characters', () => {
    expect(isValidWidgetId('gov-health-2')).toBe(true);
    expect(isValidWidgetId('a'.repeat(64))).toBe(true);
  });

  it('rejects empty, oversized, uppercase and non-string ids', () => {
    expect(isValidWidgetId('')).toBe(false);
    expect(isValidWidgetId('a'.repeat(65))).toBe(false);
    expect(isValidWidgetId('Widget')).toBe(false);
    expect(isValidWidgetId(42)).toBe(false);
    expect(isValidWidgetId(undefined)).toBe(false);
  });

  it('rejects hostile ids containing quotes, markup or whitespace', () => {
    expect(isValidWidgetId("x'); alert(1); ('")).toBe(false);
    expect(isValidWidgetId('x</script><script>alert(1)</script>')).toBe(false);
    expect(isValidWidgetId('x"y')).toBe(false);
    expect(isValidWidgetId('x y')).toBe(false);
  });
});

describe('buildWidgetSandboxHtml', () => {
  it('embeds a valid id as a JSON string literal in every postMessage', () => {
    const html = buildWidgetSandboxHtml('my-widget');
    expect(html.match(/widgetId: "my-widget"/g)).toHaveLength(3);
    expect(html).not.toContain("'my-widget'");
  });

  it('throws for hostile ids instead of producing markup', () => {
    expect(() => buildWidgetSandboxHtml("x'); alert(1); ('")).toThrow('Invalid widget id');
    expect(() => buildWidgetSandboxHtml('</script><script>alert(1)</script>')).toThrow('Invalid widget id');
  });
});
