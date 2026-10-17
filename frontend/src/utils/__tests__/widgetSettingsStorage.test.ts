import { describe, it, expect, beforeEach } from 'vitest';
import type { InstalledWidget } from '../../types/widget';
import {
  INSTALLED_WIDGETS_STORAGE_KEY,
  MAX_WIDGET_SETTINGS_BYTES,
  persistWidgetSettings,
  readInstalledWidgets,
  validateWidgetSettings,
} from '../widgetSettingsStorage';

const installed = (id: string, settings: Record<string, unknown> = {}): InstalledWidget => ({
  id,
  metadata: { id, name: id, version: '1.0.0', description: '', author: '', entryPoint: '' } as InstalledWidget['metadata'],
  permissions: { notifications: false } as InstalledWidget['permissions'],
  settings,
  enabled: true,
  installDate: '2026-01-01T00:00:00.000Z',
  usageCount: 0,
});

const seedInstalled = (widgets: InstalledWidget[]) =>
  localStorage.setItem(INSTALLED_WIDGETS_STORAGE_KEY, JSON.stringify(widgets));

describe('validateWidgetSettings', () => {
  it('accepts a plain object and returns a normalized copy', () => {
    const result = validateWidgetSettings({ refreshSeconds: 30, title: 'Treasury' });

    expect(result).toEqual({ ok: true, settings: { refreshSeconds: 30, title: 'Treasury' } });
  });

  it('rejects arrays, null and primitives', () => {
    for (const value of [null, [], 'text', 12, true, undefined]) {
      expect(validateWidgetSettings(value).ok).toBe(false);
    }
  });

  it('rejects values that cannot be serialized', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(validateWidgetSettings(cyclic)).toEqual({
      ok: false,
      error: 'Settings must be JSON-serializable',
    });
    expect(validateWidgetSettings({ big: 1n }).ok).toBe(false);
  });

  it('rejects settings above the size cap', () => {
    const tooLarge = { blob: 'x'.repeat(MAX_WIDGET_SETTINGS_BYTES) };

    expect(validateWidgetSettings(tooLarge)).toEqual({
      ok: false,
      error: `Settings exceed ${MAX_WIDGET_SETTINGS_BYTES} bytes`,
    });
  });
});

describe('persistWidgetSettings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('survives a remount: settings saved earlier are read back from storage', () => {
    seedInstalled([installed('w1'), installed('w2')]);

    const saved = persistWidgetSettings('w1', { theme: 'dark' });
    expect(saved.ok).toBe(true);

    // A fresh mount reads the installed widgets from storage again
    const afterRemount = readInstalledWidgets();
    expect(afterRemount.find((w) => w.id === 'w1')?.settings).toEqual({ theme: 'dark' });
  });

  it('only changes the target widget and leaves the others intact', () => {
    seedInstalled([installed('w1', { keep: true }), installed('w2', { other: 1 })]);

    persistWidgetSettings('w1', { theme: 'light' });

    const widgets = readInstalledWidgets();
    expect(widgets.find((w) => w.id === 'w2')?.settings).toEqual({ other: 1 });
    expect(widgets.find((w) => w.id === 'w1')?.enabled).toBe(true);
  });

  it('replaces previously saved settings', () => {
    seedInstalled([installed('w1')]);

    persistWidgetSettings('w1', { a: 1 });
    persistWidgetSettings('w1', { b: 2 });

    expect(readInstalledWidgets()[0].settings).toEqual({ b: 2 });
  });

  it('fails for a widget that is not installed and writes nothing', () => {
    seedInstalled([installed('w1')]);

    expect(persistWidgetSettings('missing', { a: 1 })).toEqual({
      ok: false,
      error: 'Widget is not installed',
    });
    expect(readInstalledWidgets()).toHaveLength(1);
    expect(readInstalledWidgets()[0].settings).toEqual({});
  });

  it('does not save invalid settings', () => {
    seedInstalled([installed('w1', { a: 1 })]);

    const result = persistWidgetSettings('w1', ['not', 'an', 'object']);

    expect(result.ok).toBe(false);
    expect(readInstalledWidgets()[0].settings).toEqual({ a: 1 });
  });
});
