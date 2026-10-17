import { beforeEach, describe, it, expect, vi } from 'vitest';
import type { WidgetPermissions } from '../types/widget';
import { getDataActionPermission, hasPermission, permissionDenied, resolveNavigationPath, resolvePermissionRequest } from './widgetPermissions';

describe('getDataActionPermission', () => {
  it('maps each data action to its required permission', () => {
    expect(getDataActionPermission('getProposals')).toBe('proposals');
    expect(getDataActionPermission('getVaultConfig')).toBe('vaultConfig');
  });

  it('returns null for unknown or non-string actions', () => {
    expect(getDataActionPermission('deleteEverything')).toBeNull();
    expect(getDataActionPermission('constructor')).toBeNull();
    expect(getDataActionPermission(undefined)).toBeNull();
    expect(getDataActionPermission({ action: 'getProposals' })).toBeNull();
  });
});

describe('hasPermission', () => {
  it('grants only permissions explicitly set to true', () => {
    const permissions: WidgetPermissions = { proposals: true, vaultConfig: false };
    expect(hasPermission(permissions, 'proposals')).toBe(true);
    expect(hasPermission(permissions, 'vaultConfig')).toBe(false);
    expect(hasPermission(permissions, 'events')).toBe(false);
  });

  it('does not treat truthy non-boolean values as granted', () => {
    const permissions = { proposals: 'yes' } as unknown as WidgetPermissions;
    expect(hasPermission(permissions, 'proposals')).toBe(false);
  });
});

describe('permissionDenied', () => {
  it('returns a typed permission_denied payload naming the permission', () => {
    expect(permissionDenied('proposals')).toEqual({ error: 'permission_denied', permission: 'proposals' });
  });
});

describe('resolvePermissionRequest', () => {
  const widget = { id: 'gov-widget', permissions: { proposals: true } as WidgetPermissions };
  const never = () => {
    throw new Error('should not prompt');
  };

  beforeEach(() => {
    localStorage.clear();
  });

  it('grants a declared permission when the user allows it', () => {
    const ask = vi.fn(() => true);
    expect(resolvePermissionRequest(widget, 'proposals', ask)).toBe(true);
    expect(ask).toHaveBeenCalledWith('proposals');
  });

  it('denies a declared permission when the user refuses it', () => {
    expect(resolvePermissionRequest(widget, 'proposals', () => false)).toBe(false);
  });

  it('denies an undeclared permission without prompting', () => {
    expect(resolvePermissionRequest(widget, 'wallet', never)).toBe(false);
  });

  it('denies unknown permission names without prompting', () => {
    expect(resolvePermissionRequest(widget, 'constructor', never)).toBe(false);
    expect(resolvePermissionRequest(widget, undefined, never)).toBe(false);
  });

  it('remembers the decision per widget and does not prompt again', () => {
    resolvePermissionRequest(widget, 'proposals', () => true);
    expect(resolvePermissionRequest(widget, 'proposals', never)).toBe(true);

    const denied = { ...widget, id: 'other-widget' };
    resolvePermissionRequest(denied, 'proposals', () => false);
    expect(resolvePermissionRequest(denied, 'proposals', never)).toBe(false);
  });
});

describe('resolveNavigationPath', () => {
  it('returns allowlisted routes unchanged', () => {
    expect(resolveNavigationPath('/dashboard/proposals')).toBe('/dashboard/proposals');
  });

  it('rejects routes that are well formed but not allowlisted', () => {
    expect(resolveNavigationPath('/dashboard/settings')).toBeNull();
    expect(resolveNavigationPath('/dashboard/proposals/extra')).toBeNull();
  });

  it('rejects absolute and protocol-relative URLs', () => {
    expect(resolveNavigationPath('https://evil.example/dashboard/proposals')).toBeNull();
    expect(resolveNavigationPath('//evil.example/dashboard/proposals')).toBeNull();
    expect(resolveNavigationPath('javascript:alert(1)')).toBeNull();
  });

  it('rejects query strings, fragments, traversal and uppercase paths', () => {
    expect(resolveNavigationPath('/dashboard/proposals?x=1')).toBeNull();
    expect(resolveNavigationPath('/dashboard/proposals#top')).toBeNull();
    expect(resolveNavigationPath('/dashboard/../settings')).toBeNull();
    expect(resolveNavigationPath('/Dashboard/Proposals')).toBeNull();
  });

  it('rejects non-string input', () => {
    expect(resolveNavigationPath(undefined)).toBeNull();
    expect(resolveNavigationPath(['/dashboard/proposals'])).toBeNull();
  });
});
