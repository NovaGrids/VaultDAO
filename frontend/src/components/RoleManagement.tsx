import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Shield, UserPlus, Search, Users, Check, Minus, Clock,
  ChevronUp, ChevronDown, ArrowRight, Filter, X, Plus,
} from 'lucide-react';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import { useActionReadiness } from '../hooks/useActionReadiness';
import ConfirmationModal from './modals/ConfirmationModal';
import ReadinessWarning from './ReadinessWarning';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RoleAssignment {
  address: string;
  role: number;
}

/** Granular permission — mirrors the on-chain Permission enum (u32) */
export const Permission = {
  ViewProposals: 0,
  CreateProposals: 1,
  ApproveProposals: 2,
  ExecuteProposals: 3,
  ManageRoles: 4,
  ManageSigners: 5,
  UpdateConfig: 6,
  UpdateLimits: 7,
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

const PERMISSION_LABELS: Record<Permission, string> = {
  [Permission.ViewProposals]: 'View Proposals',
  [Permission.CreateProposals]: 'Create Proposals',
  [Permission.ApproveProposals]: 'Approve Proposals',
  [Permission.ExecuteProposals]: 'Execute Proposals',
  [Permission.ManageRoles]: 'Manage Roles',
  [Permission.ManageSigners]: 'Manage Signers',
  [Permission.UpdateConfig]: 'Update Config',
  [Permission.UpdateLimits]: 'Update Limits',
};

const ALL_PERMISSIONS = Object.values(Permission) as Permission[];

interface PermissionGrant {
  address: string;
  permission: Permission;
  granted: boolean;
  expiresAt?: number; // unix ms
}

interface Delegation {
  delegator: string;
  delegate: string;
  createdAt: number;
}

type SortField = 'address' | 'role' | 'expiry';
type SortDir = 'asc' | 'desc';
type ActiveTab = 'matrix' | 'delegations';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ROLES = {
  0: { name: 'Member', color: 'text-gray-400', description: 'View-only access to vault data' },
  1: { name: 'Treasurer', color: 'text-blue-400', description: 'Create and approve proposals' },
  2: { name: 'Admin', color: 'text-purple-400', description: 'Full control, manage signers and config' },
} as const;

/** Default permissions granted per role (used to seed the matrix when no on-chain data) */
const ROLE_DEFAULT_PERMISSIONS: Record<number, Permission[]> = {
  0: [Permission.ViewProposals],
  1: [Permission.ViewProposals, Permission.CreateProposals, Permission.ApproveProposals, Permission.ExecuteProposals],
  2: ALL_PERMISSIONS,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatRelativeExpiry(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return 'Expired';
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `expires in ${days}d`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `expires in ${hours}h`;
  return 'expires soon';
}

function formatAbsoluteDate(ms: number): string {
  return new Date(ms).toLocaleString();
}

function validateStellarAddress(addr: string): boolean {
  return /^G[A-Z0-9]{55}$/.test(addr);
}

function truncateAddress(addr: string): string {
  return `${addr.slice(0, 8)}...${addr.slice(-8)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface PermissionCellProps {
  grant: PermissionGrant | undefined;
}

const PermissionCell: React.FC<PermissionCellProps> = ({ grant }) => {
  if (!grant || !grant.granted) {
    return (
      <td className="px-3 py-2 text-center">
        <Minus size={14} className="mx-auto text-gray-600" aria-label="Not granted" />
      </td>
    );
  }
  if (grant.expiresAt) {
    const expired = grant.expiresAt < Date.now();
    return (
      <td className="px-3 py-2 text-center">
        <span
          title={formatAbsoluteDate(grant.expiresAt)}
          className={`inline-flex items-center gap-1 text-xs ${expired ? 'text-red-400' : 'text-amber-400'}`}
          aria-label={expired ? 'Expired' : formatRelativeExpiry(grant.expiresAt)}
        >
          <Clock size={12} />
          {expired ? 'Expired' : formatRelativeExpiry(grant.expiresAt)}
        </span>
      </td>
    );
  }
  return (
    <td className="px-3 py-2 text-center">
      <Check size={14} className="mx-auto text-green-400" aria-label="Granted" />
    </td>
  );
};

// ---------------------------------------------------------------------------
// Grant Permission Modal
// ---------------------------------------------------------------------------

interface GrantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGrant: (address: string, permission: Permission, expiresAt?: number) => Promise<void>;
  loading: boolean;
}

const GrantPermissionModal: React.FC<GrantModalProps> = ({ isOpen, onClose, onGrant, loading }) => {
  const [address, setAddress] = useState('');
  const [permission, setPermission] = useState<Permission>(Permission.ViewProposals);
  const [useExpiry, setUseExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    const normalized = address.trim().toUpperCase();
    if (!validateStellarAddress(normalized)) {
      setError('Invalid Stellar address format');
      return;
    }
    setError('');
    const expiresAt = useExpiry && expiryDate ? new Date(expiryDate).getTime() : undefined;
    await onGrant(normalized, permission, expiresAt);
    setAddress('');
    setPermission(Permission.ViewProposals);
    setUseExpiry(false);
    setExpiryDate('');
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" role="dialog" aria-modal="true" aria-labelledby="grant-modal-title">
      <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md">
        <div className="p-6 border-b border-gray-700">
          <h3 id="grant-modal-title" className="text-xl font-bold text-white flex items-center gap-2">
            <Plus size={18} className="text-purple-400" /> Grant Permission
          </h3>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Address</label>
            <input
              type="text"
              placeholder="Stellar Address (G...)"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            />
            {error && <p className="text-red-400 text-xs mt-1">{error}</p>}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-1">Permission</label>
            <select
              value={permission}
              onChange={(e) => setPermission(Number(e.target.value) as Permission)}
              className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
            >
              {ALL_PERMISSIONS.map((p) => (
                <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium text-gray-400 cursor-pointer">
              <input type="checkbox" checked={useExpiry} onChange={(e) => setUseExpiry(e.target.checked)} className="rounded" />
              Set expiry date
            </label>
            {useExpiry && (
              <input
                type="datetime-local"
                value={expiryDate}
                onChange={(e) => setExpiryDate(e.target.value)}
                className="mt-2 w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
              />
            )}
          </div>
        </div>
        <div className="p-6 border-t border-gray-700 flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button onClick={onClose} className="w-full sm:w-auto px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors min-h-[44px]">Cancel</button>
          <button onClick={handleSubmit} disabled={loading} className="w-full sm:w-auto px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-h-[44px]">
            {loading ? 'Granting…' : 'Grant Permission'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

const RoleManagement: React.FC = () => {
  const { getAllRoles, setRole, getUserRole, loading } = useVaultContract();
  const { notify } = useToast();
  const { checkReady } = useActionReadiness();

  // Core state
  const [currentUserRole, setCurrentUserRole] = useState<number>(0);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Permission matrix state (seeded from role defaults; would be replaced by on-chain data)
  const [permissionGrants, setPermissionGrants] = useState<PermissionGrant[]>([]);

  // Delegations (local state — would be fetched from on-chain once implemented)
  const [delegations] = useState<Delegation[]>([]);

  // UI state
  const [activeTab, setActiveTab] = useState<ActiveTab>('matrix');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRole, setFilterRole] = useState<number | 'all'>('all');
  const [filterPermission, setFilterPermission] = useState<Permission | 'all'>('all');
  const [filterExpiry, setFilterExpiry] = useState<'all' | 'expiring' | 'expired'>('all');
  const [sortField, setSortField] = useState<SortField>('address');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Assign role form
  const [newAddress, setNewAddress] = useState('');
  const [selectedRole, setSelectedRole] = useState<number>(0);

  // Grant permission modal
  const [grantModalOpen, setGrantModalOpen] = useState(false);

  // Revoke confirmation
  const [revokeTarget, setRevokeTarget] = useState<{ address: string; permission: Permission } | null>(null);

  // Role change confirmation
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'assign' | 'change' | 'revoke';
    address?: string;
    currentRole?: number;
    newRole?: number;
  }>({ isOpen: false, type: 'assign' });

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const role = await getUserRole();
      setCurrentUserRole(role);
      if (role === 2) {
        const roles = await getAllRoles?.() || [];
        setRoleAssignments(roles);
        // Seed permission grants from role defaults
        const grants: PermissionGrant[] = [];
        for (const ra of roles) {
          const defaults = ROLE_DEFAULT_PERMISSIONS[ra.role] ?? [];
          for (const perm of ALL_PERMISSIONS) {
            grants.push({ address: ra.address, permission: perm, granted: defaults.includes(perm) });
          }
        }
        setPermissionGrants(grants);
      }
    } catch (err) {
      console.error('Failed to load role data:', err);
      notify('config_updated', 'Failed to load role assignments', 'error');
    } finally {
      setIsRefreshing(false);
    }
  }, [getAllRoles, getUserRole, notify]);

  useEffect(() => { loadData(); }, [loadData]);

  // ---------------------------------------------------------------------------
  // Sorting & filtering
  // ---------------------------------------------------------------------------

  const sortedFilteredAssignments = useMemo(() => {
    let list = [...roleAssignments];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(r =>
        r.address.toLowerCase().includes(q) ||
        ROLES[r.role as keyof typeof ROLES]?.name.toLowerCase().includes(q)
      );
    }
    if (filterRole !== 'all') {
      list = list.filter(r => r.role === filterRole);
    }
    if (filterPermission !== 'all') {
      list = list.filter(r => {
        const grant = permissionGrants.find(g => g.address === r.address && g.permission === filterPermission);
        return grant?.granted;
      });
    }
    if (filterExpiry !== 'all') {
      const now = Date.now();
      list = list.filter(r => {
        const grants = permissionGrants.filter(g => g.address === r.address && g.expiresAt);
        if (filterExpiry === 'expired') return grants.some(g => g.expiresAt! < now);
        if (filterExpiry === 'expiring') return grants.some(g => g.expiresAt! > now && g.expiresAt! - now < 7 * 86_400_000);
        return false;
      });
    }

    list.sort((a, b) => {
      let cmp = 0;
      if (sortField === 'address') cmp = a.address.localeCompare(b.address);
      else if (sortField === 'role') cmp = a.role - b.role;
      else if (sortField === 'expiry') {
        const aExp = permissionGrants.find(g => g.address === a.address && g.expiresAt)?.expiresAt ?? Infinity;
        const bExp = permissionGrants.find(g => g.address === b.address && g.expiresAt)?.expiresAt ?? Infinity;
        cmp = aExp - bExp;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [roleAssignments, searchQuery, filterRole, filterPermission, filterExpiry, sortField, sortDir, permissionGrants]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortField(field); setSortDir('asc'); }
  };

  const SortIcon: React.FC<{ field: SortField }> = ({ field }) => {
    if (sortField !== field) return <ChevronUp size={12} className="text-gray-600" />;
    return sortDir === 'asc' ? <ChevronUp size={12} className="text-purple-400" /> : <ChevronDown size={12} className="text-purple-400" />;
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const handleAssignRole = () => {
    const normalized = newAddress.trim().toUpperCase();
    if (!validateStellarAddress(normalized)) {
      notify('config_updated', 'Invalid Stellar address format', 'error');
      return;
    }
    const existing = roleAssignments.find(r => r.address === normalized);
    if (existing) {
      notify('config_updated', 'Address already has a role. Use Change Role instead.', 'info');
      return;
    }
    setConfirmModal({ isOpen: true, type: 'assign', address: normalized, newRole: selectedRole });
  };

  const handleChangeRole = (address: string, currentRole: number) => {
    setConfirmModal({ isOpen: true, type: 'change', address, currentRole, newRole: currentRole });
  };

  const handleRevokeRole = (address: string, currentRole: number) => {
    setConfirmModal({ isOpen: true, type: 'revoke', address, currentRole });
  };

  const executeRoleChange = async () => {
    const { ready, message } = checkReady();
    if (!ready) {
      notify('config_updated', message ?? 'Not ready', 'error');
      setConfirmModal({ isOpen: false, type: 'assign' });
      return;
    }
    try {
      const { type, address } = confirmModal;
      if (!address) return;
      if (type === 'revoke') {
        await setRole?.(address, 0);
        notify('config_updated', 'Role revoked successfully', 'success');
      } else {
        await setRole?.(address, confirmModal.newRole ?? 0);
        notify('config_updated', `Role ${type === 'assign' ? 'assigned' : 'changed'} successfully`, 'success');
      }
      if (type === 'assign') { setNewAddress(''); setSelectedRole(0); }
      await loadData();
    } catch (err: unknown) {
      notify('config_updated', err instanceof Error ? err.message : 'Failed to update role', 'error');
    } finally {
      setConfirmModal({ isOpen: false, type: 'assign' });
    }
  };

  const handleGrantPermission = async (address: string, permission: Permission, expiresAt?: number) => {
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); return; }
    try {
      // Optimistic update — replace with on-chain call once contract supports it
      setPermissionGrants(prev => {
        const filtered = prev.filter(g => !(g.address === address && g.permission === permission));
        return [...filtered, { address, permission, granted: true, expiresAt }];
      });
      notify('config_updated', `Permission "${PERMISSION_LABELS[permission]}" granted`, 'success');
      setGrantModalOpen(false);
    } catch (err: unknown) {
      notify('config_updated', err instanceof Error ? err.message : 'Failed to grant permission', 'error');
    }
  };

  const handleRevokePermission = async () => {
    if (!revokeTarget) return;
    const { ready, message } = checkReady();
    if (!ready) { notify('config_updated', message ?? 'Not ready', 'error'); setRevokeTarget(null); return; }
    try {
      setPermissionGrants(prev =>
        prev.map(g =>
          g.address === revokeTarget.address && g.permission === revokeTarget.permission
            ? { ...g, granted: false, expiresAt: undefined }
            : g
        )
      );
      notify('config_updated', `Permission "${PERMISSION_LABELS[revokeTarget.permission]}" revoked`, 'success');
    } catch (err: unknown) {
      notify('config_updated', err instanceof Error ? err.message : 'Failed to revoke permission', 'error');
    } finally {
      setRevokeTarget(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Non-admin guard
  // ---------------------------------------------------------------------------

  if (currentUserRole !== 2) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
        <Shield size={48} className="mx-auto text-gray-600 mb-4" />
        <h3 className="text-xl font-semibold mb-2">Admin Access Required</h3>
        <p className="text-gray-400">Only administrators can manage roles.</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const roleStats = {
    total: roleAssignments.length,
    admins: roleAssignments.filter(r => r.role === 2).length,
    treasurers: roleAssignments.filter(r => r.role === 1).length,
    members: roleAssignments.filter(r => r.role === 0).length,
  };

  return (
    <div className="space-y-6">
      <ReadinessWarning />

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total', value: roleStats.total, color: 'text-white' },
          { label: 'Admins', value: roleStats.admins, color: 'text-purple-400' },
          { label: 'Treasurers', value: roleStats.treasurers, color: 'text-blue-400' },
          { label: 'Members', value: roleStats.members, color: 'text-gray-400' },
        ].map(s => (
          <div key={s.label} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <p className={`text-sm ${s.color}`}>{s.label}</p>
            <p className="text-2xl font-bold text-white">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Assign Role Form */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">
          <UserPlus size={20} /> Assign Role
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <input
            type="text"
            placeholder="Stellar Address (G...)"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            className="md:col-span-2 px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
          />
          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(parseInt(e.target.value))}
            className="px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
          >
            <option value={0}>Member</option>
            <option value={1}>Treasurer</option>
            <option value={2}>Admin</option>
          </select>
        </div>
        <button
          onClick={handleAssignRole}
          disabled={loading || isRefreshing || !newAddress.trim()}
          className="mt-4 w-full md:w-auto px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-h-[44px]"
        >
          {loading ? 'Submitting…' : 'Assign Role'}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700 w-fit">
        {(['matrix', 'delegations'] as ActiveTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              activeTab === tab ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'
            }`}
          >
            {tab === 'matrix' ? 'Permission Matrix' : 'Delegations'}
          </button>
        ))}
      </div>

      {activeTab === 'matrix' && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6 space-y-4">
          {/* Toolbar */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <h3 className="text-lg font-semibold flex items-center gap-2 text-white">
              <Users size={20} /> Permission Matrix ({sortedFilteredAssignments.length})
            </h3>
            <div className="flex flex-wrap gap-2">
              {/* Search */}
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                <input
                  type="text"
                  placeholder="Search address or role…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 w-48 min-h-[40px] text-sm"
                />
              </div>
              {/* Role filter */}
              <select
                value={filterRole}
                onChange={(e) => setFilterRole(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
                className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[40px]"
                aria-label="Filter by role"
              >
                <option value="all">All Roles</option>
                <option value={0}>Member</option>
                <option value={1}>Treasurer</option>
                <option value={2}>Admin</option>
              </select>
              {/* Permission filter */}
              <select
                value={filterPermission}
                onChange={(e) => setFilterPermission(e.target.value === 'all' ? 'all' : Number(e.target.value) as Permission)}
                className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[40px]"
                aria-label="Filter by permission"
              >
                <option value="all">All Permissions</option>
                {ALL_PERMISSIONS.map(p => <option key={p} value={p}>{PERMISSION_LABELS[p]}</option>)}
              </select>
              {/* Expiry filter */}
              <select
                value={filterExpiry}
                onChange={(e) => setFilterExpiry(e.target.value as typeof filterExpiry)}
                className="px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[40px]"
                aria-label="Filter by expiry"
              >
                <option value="all">All Expiry</option>
                <option value="expiring">Expiring Soon</option>
                <option value="expired">Expired</option>
              </select>
              {/* Clear filters */}
              {(searchQuery || filterRole !== 'all' || filterPermission !== 'all' || filterExpiry !== 'all') && (
                <button
                  onClick={() => { setSearchQuery(''); setFilterRole('all'); setFilterPermission('all'); setFilterExpiry('all'); }}
                  className="p-2 text-gray-400 hover:text-white transition-colors"
                  title="Clear filters"
                >
                  <X size={16} />
                </button>
              )}
              {/* Grant button */}
              <button
                onClick={() => setGrantModalOpen(true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors min-h-[40px]"
              >
                <Plus size={14} /> Grant Permission
              </button>
            </div>
          </div>

          {/* Matrix table */}
          {isRefreshing ? (
            <p className="text-center text-gray-400 py-8">Loading…</p>
          ) : sortedFilteredAssignments.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No assignments found.</p>
          ) : (
            <div className="overflow-x-auto" role="region" aria-label="Permission matrix">
              <table className="w-full text-sm" data-testid="permission-matrix">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-3 px-3 text-gray-400 font-medium">
                      <button onClick={() => toggleSort('address')} className="flex items-center gap-1 hover:text-white transition-colors">
                        Address <SortIcon field="address" />
                      </button>
                    </th>
                    <th className="text-left py-3 px-3 text-gray-400 font-medium">
                      <button onClick={() => toggleSort('role')} className="flex items-center gap-1 hover:text-white transition-colors">
                        Role <SortIcon field="role" />
                      </button>
                    </th>
                    {ALL_PERMISSIONS.map(p => (
                      <th key={p} className="py-3 px-3 text-gray-400 font-medium text-center text-xs whitespace-nowrap">
                        {PERMISSION_LABELS[p]}
                      </th>
                    ))}
                    <th className="text-right py-3 px-3 text-gray-400 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedFilteredAssignments.map(ra => (
                    <tr key={ra.address} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                      <td className="py-3 px-3">
                        <span className="font-mono text-xs" title={ra.address}>{truncateAddress(ra.address)}</span>
                      </td>
                      <td className="py-3 px-3">
                        <span className={`font-medium ${ROLES[ra.role as keyof typeof ROLES]?.color}`}>
                          {ROLES[ra.role as keyof typeof ROLES]?.name}
                        </span>
                      </td>
                      {ALL_PERMISSIONS.map(p => {
                        const grant = permissionGrants.find(g => g.address === ra.address && g.permission === p);
                        return <PermissionCell key={p} grant={grant} />;
                      })}
                      <td className="py-3 px-3">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleChangeRole(ra.address, ra.role)}
                            disabled={loading}
                            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-xs rounded-lg transition-colors min-h-[32px]"
                          >
                            Change
                          </button>
                          <button
                            onClick={() => handleRevokeRole(ra.address, ra.role)}
                            disabled={loading}
                            className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs rounded-lg transition-colors min-h-[32px]"
                          >
                            Revoke
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'delegations' && (
        <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
          <h3 className="text-lg font-semibold mb-4 flex items-center gap-2 text-white">
            <ArrowRight size={20} /> Active Vote Delegations
          </h3>
          {delegations.length === 0 ? (
            <p className="text-center text-gray-400 py-8">No active delegations.</p>
          ) : (
            <div className="space-y-3">
              {delegations.map((d, i) => (
                <div key={i} className="flex items-center gap-3 p-3 bg-gray-900 rounded-lg border border-gray-700">
                  <span className="font-mono text-xs text-gray-300" title={d.delegator}>{truncateAddress(d.delegator)}</span>
                  <ArrowRight size={16} className="text-purple-400 flex-shrink-0" />
                  <span className="font-mono text-xs text-gray-300" title={d.delegate}>{truncateAddress(d.delegate)}</span>
                  <span className="ml-auto text-xs text-gray-500">{new Date(d.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Grant Permission Modal */}
      <GrantPermissionModal
        isOpen={grantModalOpen}
        onClose={() => setGrantModalOpen(false)}
        onGrant={handleGrantPermission}
        loading={loading}
      />

      {/* Revoke Permission Confirmation */}
      <ConfirmationModal
        isOpen={!!revokeTarget}
        title="Revoke Permission"
        message={revokeTarget ? `Revoke "${PERMISSION_LABELS[revokeTarget.permission]}" from ${truncateAddress(revokeTarget.address)}?` : ''}
        confirmText="Revoke"
        onConfirm={handleRevokePermission}
        onCancel={() => setRevokeTarget(null)}
        isDestructive
      />

      {/* Role change confirmation */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen && confirmModal.type !== 'change'}
        title={confirmModal.type === 'assign' ? 'Assign Role' : 'Revoke Role'}
        message={
          confirmModal.type === 'assign'
            ? `Assign ${ROLES[confirmModal.newRole as keyof typeof ROLES]?.name} role to ${confirmModal.address ? truncateAddress(confirmModal.address) : ''}?`
            : `Revoke ${ROLES[confirmModal.currentRole as keyof typeof ROLES]?.name} role from ${confirmModal.address ? truncateAddress(confirmModal.address) : ''}? This will set their role to Member.`
        }
        confirmText={confirmModal.type === 'revoke' ? 'Revoke' : 'Confirm'}
        onConfirm={executeRoleChange}
        onCancel={() => setConfirmModal({ isOpen: false, type: 'assign' })}
        isDestructive={confirmModal.type === 'revoke'}
      />

      {/* Change role inline modal */}
      {confirmModal.type === 'change' && confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md">
            <div className="p-6 border-b border-gray-700">
              <h3 className="text-xl font-bold text-white">Change Role</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-300">Select new role for {confirmModal.address ? truncateAddress(confirmModal.address) : ''}</p>
              <select
                value={confirmModal.newRole}
                onChange={(e) => setConfirmModal({ ...confirmModal, newRole: parseInt(e.target.value) })}
                className="w-full px-4 py-2.5 bg-gray-900 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 min-h-[44px]"
              >
                <option value={0}>Member</option>
                <option value={1}>Treasurer</option>
                <option value={2}>Admin</option>
              </select>
            </div>
            <div className="p-6 border-t border-gray-700 flex flex-col sm:flex-row gap-3 sm:justify-end">
              <button onClick={() => setConfirmModal({ isOpen: false, type: 'assign' })} className="w-full sm:w-auto px-6 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors min-h-[44px]">Cancel</button>
              <button onClick={executeRoleChange} className="w-full sm:w-auto px-6 py-2.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors min-h-[44px]">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;
