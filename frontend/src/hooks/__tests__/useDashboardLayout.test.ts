import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import {
  useDashboardLayout,
  layoutStorageKey,
  mergeLayout,
  applyConstraints,
  type DashboardLayout,
} from '../useDashboardLayout';

const CONTRACT_A = 'CAAAA';
const CONTRACT_B = 'CBBBB';

const defaultLayout: DashboardLayout = [
  { i: 'balance', x: 0, y: 0, w: 4, h: 2, minW: 2, maxW: 8, minH: 2, maxH: 6 },
  { i: 'proposals', x: 4, y: 0, w: 8, h: 4, minW: 4, minH: 2 },
];

beforeEach(() => {
  window.localStorage.clear();
});

describe('useDashboardLayout', () => {
  it('starts from the default layout when nothing is stored', () => {
    const { result } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );

    expect(result.current.layout).toEqual(defaultLayout);
    expect(result.current.isCustomized).toBe(false);
  });

  it('persists a moved widget to localStorage under the contract key', () => {
    const { result } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );

    act(() => {
      result.current.saveLayout([
        { ...defaultLayout[0], x: 6, y: 2 },
        defaultLayout[1],
      ]);
    });

    const stored = JSON.parse(
      window.localStorage.getItem(layoutStorageKey(CONTRACT_A)) ?? '[]',
    );
    expect(stored[0]).toMatchObject({ i: 'balance', x: 6, y: 2 });
    expect(result.current.isCustomized).toBe(true);
  });

  it('restores a stored layout on remount', () => {
    window.localStorage.setItem(
      layoutStorageKey(CONTRACT_A),
      JSON.stringify([{ i: 'balance', x: 8, y: 1, w: 4, h: 3 }]),
    );

    const { result } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );

    expect(result.current.layout[0]).toMatchObject({ x: 8, y: 1, w: 4, h: 3 });
    // Widgets absent from storage keep their default placement.
    expect(result.current.layout[1]).toEqual(defaultLayout[1]);
  });

  it('keeps layouts separate per contract id', () => {
    const { result: a } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );
    act(() => {
      a.current.saveLayout([{ ...defaultLayout[0], x: 6 }, defaultLayout[1]]);
    });

    const { result: b } = renderHook(() =>
      useDashboardLayout(CONTRACT_B, defaultLayout),
    );

    expect(b.current.layout).toEqual(defaultLayout);
    expect(window.localStorage.getItem(layoutStorageKey(CONTRACT_B))).toBeNull();
  });

  it('clamps a resize to the widget min/max constraints', () => {
    const { result } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );

    act(() => {
      result.current.saveLayout([
        { ...defaultLayout[0], w: 12, h: 1 },
        defaultLayout[1],
      ]);
    });

    expect(result.current.layout[0].w).toBe(8); // maxW
    expect(result.current.layout[0].h).toBe(2); // minH
  });

  it('reset restores the defaults and clears storage', () => {
    const { result } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );

    act(() => {
      result.current.saveLayout([{ ...defaultLayout[0], x: 6 }, defaultLayout[1]]);
    });
    expect(result.current.isCustomized).toBe(true);

    act(() => {
      result.current.resetLayout();
    });

    expect(result.current.layout).toEqual(defaultLayout);
    expect(result.current.isCustomized).toBe(false);
    expect(window.localStorage.getItem(layoutStorageKey(CONTRACT_A))).toBeNull();
  });

  it('falls back to defaults when stored JSON is corrupt', () => {
    window.localStorage.setItem(layoutStorageKey(CONTRACT_A), '{not json');

    const { result } = renderHook(() =>
      useDashboardLayout(CONTRACT_A, defaultLayout),
    );

    expect(result.current.layout).toEqual(defaultLayout);
  });
});

describe('mergeLayout', () => {
  it('ignores entries that are not valid widget layouts', () => {
    const merged = mergeLayout(defaultLayout, [
      { i: 'balance', x: 1 },
      'nonsense',
      null,
    ]);

    expect(merged).toEqual(defaultLayout);
  });

  it('drops widgets that no longer exist', () => {
    const merged = mergeLayout(defaultLayout, [
      { i: 'retired-widget', x: 0, y: 0, w: 2, h: 2 },
    ]);

    expect(merged.map((w) => w.i)).toEqual(['balance', 'proposals']);
  });
});

describe('applyConstraints', () => {
  it('never returns a negative position', () => {
    const clamped = applyConstraints(
      { i: 'balance', x: -4, y: -1, w: 4, h: 2 },
      defaultLayout[0],
    );

    expect(clamped.x).toBe(0);
    expect(clamped.y).toBe(0);
  });
});
