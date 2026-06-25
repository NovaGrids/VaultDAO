import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Shield, UserPlus, Users, Undo2, GripVertical } from 'lucide-react';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import { useActionReadiness } from '../hooks/useActionReadiness';
import ConfirmationModal from './modals/ConfirmationModal';
import ReadinessWarning from './ReadinessWarning';

interface RoleAssignment {
  address: string;
  role: number;
}

interface HistoryEntry {
  timestamp: number;
  assignments: RoleAssignment[];
}

const ROLES = {
  0: { name: 'Member', color: 'text-gray-400', description: 'View-only access to vault data' },
  1: { name: 'Treasurer', color: 'text-blue-400', description: 'Create and approve proposals' },
  2: { name: 'Admin', color: 'text-purple-400', description: 'Full control, manage signers and config' }
};

const ROLE_PERMISSIONS = {
  0: ['View proposals', 'View vault balance', 'View activity'],
  1: ['All Member permissions', 'Create proposals', 'Approve proposals', 'Execute proposals'],
  2: ['All Treasurer permissions', 'Assign roles', 'Add/remove signers', 'Update configuration', 'Update spending limits']
};

const RoleManagement: React.FC = () => {
  const { getAllRoles, setRole, getUserRole, loading } = useVaultContract();
  const { notify } = useToast();
  const { checkReady } = useActionReadiness();
  const [currentUserRole, setCurrentUserRole] = useState<number>(0);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [selectedRole, setSelectedRole] = useState<number>(0);
  const [isRefreshingRoles, setIsRefreshingRoles] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    changes: RoleAssignment[];
  }>({ isOpen: false, changes: [] });

  const loadData = useCallback(async () => {
    setIsRefreshingRoles(true);
    try {
      const role = await getUserRole();
      setCurrentUserRole(role);

      if (role === 2) {
        const roles = await getAllRoles?.() || [];
        setRoleAssignments(roles);
        setHistory([{ timestamp: Date.now(), assignments: roles }]);
      }
    } catch (error) {
      console.error('Failed to load role data:', error);
      notify("config_updated", "Failed to load role assignments", "error");
    } finally {
      setIsRefreshingRoles(false);
    }
  }, [getAllRoles, getUserRole, notify]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const validateStellarAddress = (addr: string): boolean => {
    return /^G[A-Z0-9]{55}$/.test(addr);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, newRole: number) => {
    e.preventDefault();
    const address = e.dataTransfer.getData('address');
    if (!address) return;

    setRoleAssignments((prev) => {
      const updated = prev.map((r) =>
        r.address === address ? { ...r, role: newRole } : r
      );
      setHistory((h) => [...h.slice(0, Math.min(h.length, 10)), { timestamp: Date.now(), assignments: updated }]);
      return updated;
    });
  };

  const handleAddRole = () => {
    const normalizedAddress = newAddress.trim().toUpperCase();
    if (!validateStellarAddress(normalizedAddress)) {
      notify("config_updated", "Invalid Stellar address format", "error");
      return;
    }

    const existing = roleAssignments.find(r => r.address === normalizedAddress);
    if (existing) {
      notify("config_updated", "Address already assigned. Drag to change role.", "info");
      return;
    }

    const updated = [...roleAssignments, { address: normalizedAddress, role: selectedRole }];
    setRoleAssignments(updated);
    setHistory((h) => [...h.slice(0, Math.min(h.length, 10)), { timestamp: Date.now(), assignments: updated }]);
    setNewAddress('');
    setSelectedRole(0);
    notify("config_updated", "Signer added. Drag to assign role.", "success");
  };

  const handleUndo = () => {
    if (history.length <= 1) return;
    const previousState = history[history.length - 2];
    setRoleAssignments(previousState.assignments);
    setHistory((h) => h.slice(0, -1));
  };

  const handleApplyChanges = () => {
    if (history.length <= 1) {
      notify("config_updated", "No pending changes.", "info");
      return;
    }
    setConfirmModal({ isOpen: true, changes: roleAssignments });
  };

  const executeRoleChanges = async () => {
    const { ready, message } = checkReady();
    if (!ready) {
      notify('config_updated', message ?? 'Not ready', 'error');
      setConfirmModal({ isOpen: false, changes: [] });
      return;
    }

    try {
      const originalAssignments = history[0].assignments;
      for (const assignment of confirmModal.changes) {
        const original = originalAssignments.find((a) => a.address === assignment.address);
        if (!original || original.role !== assignment.role) {
          await setRole?.(assignment.address, assignment.role);
        }
      }
      notify('config_updated', 'Role changes applied successfully', 'success');
      await loadData();
    } catch (error: unknown) {
      notify("config_updated", error instanceof Error ? error.message : "Failed to apply changes", "error");
    } finally {
      setConfirmModal({ isOpen: false, changes: [] });
    }
  };

  const getChanges = (): { address: string; from: number; to: number }[] => {
    if (history.length <= 1) return [];
    const original = history[0].assignments;
    return roleAssignments
      .filter((r) => {
        const orig = original.find((a) => a.address === r.address);
        return !orig || orig.role !== r.role;
      })
      .map((r) => {
        const orig = original.find((a) => a.address === r.address);
        return { address: r.address, from: orig?.role ?? -1, to: r.role };
      });
  };

  const changes = getChanges();
  const hasPendingChanges = changes.length > 0;

  const rolesByGroup = useMemo(() => ({
    2: roleAssignments.filter((r) => r.role === 2),
    1: roleAssignments.filter((r) => r.role === 1),
    0: roleAssignments.filter((r) => r.role === 0),
  }), [roleAssignments]);

  const filteredAssignments = roleAssignments.filter(r =>
    r.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
    ROLES[r.role as keyof typeof ROLES]?.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const roleStats = {
    total: roleAssignments.length,
    admins: roleAssignments.filter(r => r.role === 2).length,
    treasurers: roleAssignments.filter(r => r.role === 1).length,
    members: roleAssignments.filter(r => r.role === 0).length
  };

  if (currentUserRole !== 2) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-8 text-center">
        <Shield size={48} className="mx-auto text-gray-600 mb-4" />
        <h3 className="text-xl font-semibold mb-2">Admin Access Required</h3>
        <p className="text-gray-400">Only administrators can manage roles.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ReadinessWarning />
      
      {/* Role Descriptions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Object.entries(ROLES).map(([roleId, role]) => (
          <div key={roleId} className="bg-gray-800 rounded-lg border border-gray-700 p-4">
            <h4 className={`font-semibold mb-2 ${role.color}`}>{role.name}</h4>
            <p className="text-sm text-gray-400 mb-3">{role.description}</p>
            <ul className="text-xs text-gray-500 space-y-1">
              {ROLE_PERMISSIONS[parseInt(roleId) as keyof typeof ROLE_PERMISSIONS].map((perm, idx) => (
                <li key={idx}>• {perm}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <p className="text-sm text-gray-400">Total</p>
          <p className="text-2xl font-bold">{roleStats.total}</p>
        </div>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <p className="text-sm text-purple-400">Admins</p>
          <p className="text-2xl font-bold">{roleStats.admins}</p>
        </div>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <p className="text-sm text-blue-400">Treasurers</p>
          <p className="text-2xl font-bold">{roleStats.treasurers}</p>
        </div>
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-4">
          <p className="text-sm text-gray-400">Members</p>
          <p className="text-2xl font-bold">{roleStats.members}</p>
        </div>
      </div>

      {/* Add Signer Form */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <UserPlus size={20} />
          Add Signer
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
          onClick={handleAddRole}
          disabled={loading || isRefreshingRoles || !newAddress.trim()}
          className="mt-4 w-full md:w-auto px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-h-[44px]"
        >
          Add Signer
        </button>
      </div>

      {/* Kanban Board */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users size={20} />
            Drag to Assign Roles
          </h3>
          <div className="flex gap-2 flex-wrap">
              <button
                onClick={handleUndo}
                disabled={history.length <= 1}
                title="Undo last drag (up to 10)"
                className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:cursor-not-allowed text-white text-sm rounded-lg transition-colors min-h-[44px]"
              >
                <Undo2 size={16} />
                <span className="hidden sm:inline">Undo</span>
              </button>
              <button
                onClick={handleApplyChanges}
                disabled={!hasPendingChanges || loading}
                className={`px-4 py-2 text-white text-sm rounded-lg font-medium transition-colors min-h-[44px] ${
                  hasPendingChanges
                    ? 'bg-green-600 hover:bg-green-700'
                    : 'bg-gray-700 cursor-not-allowed'
                }`}
              >
                Apply Changes {hasPendingChanges && `(${changes.length})`}
              </button>
            </div>
          </div>

          {isRefreshingRoles ? (
            <p className="text-center text-gray-400 py-12">Loading signers...</p>
          ) : roleAssignments.length === 0 ? (
            <p className="text-center text-gray-400 py-12">No signers assigned yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { id: '2', label: 'Admin', color: 'purple' },
                { id: '1', label: 'Treasurer', color: 'blue' },
                { id: '0', label: 'Member', color: 'gray' },
              ].map(({ id, label, color }) => (
                <div
                  key={id}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, parseInt(id))}
                  className={`bg-gray-900 rounded-lg p-4 border border-${color}-500/20 min-h-[400px]`}
                >
                  <h4 className={`text-sm font-semibold text-${color}-400 mb-4`}>{label}</h4>
                  <div className="space-y-2">
                    {rolesByGroup[parseInt(id) as keyof typeof rolesByGroup].map((assignment) => {
                      const isChanged = changes.some((c) => c.address === assignment.address);
                      return (
                        <div
                          key={assignment.address}
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('address', assignment.address);
                          }}
                          className={`p-3 rounded-lg border-2 cursor-grab active:cursor-grabbing flex items-start gap-2 transition-all ${
                            isChanged
                              ? `border-yellow-500/50 bg-yellow-500/10`
                              : `border-gray-700 bg-gray-800 hover:border-gray-600`
                          }`}
                          data-testid={`signer-card-${assignment.address}`}
                        >
                          <GripVertical size={14} className="text-gray-500 flex-shrink-0 mt-0.5" />
                          <span className="text-xs font-mono text-gray-300 truncate" title={assignment.address}>
                            {assignment.address.slice(0, 6)}...{assignment.address.slice(-6)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      {/* Pending Changes */}
      {hasPendingChanges && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <h4 className="font-semibold text-yellow-400 mb-2">Pending Changes ({changes.length})</h4>
          <div className="text-sm text-yellow-300 space-y-1">
            {changes.map((change) => (
              <div key={change.address}>
                {change.address.slice(0, 8)}... : {ROLES[change.from as keyof typeof ROLES]?.name ?? 'Unassigned'} → {ROLES[change.to as keyof typeof ROLES]?.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title="Apply Role Changes"
        message={`Apply ${changes.length} pending change${changes.length !== 1 ? 's' : ''} to the vault? This will create a multi-sig proposal.`}
        confirmText="Apply Changes"
        onConfirm={executeRoleChanges}
        onCancel={() => setConfirmModal({ isOpen: false, changes: [] })}
      />
    </div>
  );
};

export default RoleManagement;
