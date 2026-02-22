import React, { useState, useEffect } from 'react';
import { Shield, UserPlus, Search, Users } from 'lucide-react';
import { useVaultContract } from '../hooks/useVaultContract';
import { useToast } from '../hooks/useToast';
import ConfirmationModal from './modals/ConfirmationModal';

interface RoleAssignment {
  address: string;
  role: number;
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
  const { showToast } = useToast();
  const [currentUserRole, setCurrentUserRole] = useState<number>(0);
  const [roleAssignments, setRoleAssignments] = useState<RoleAssignment[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [newAddress, setNewAddress] = useState('');
  const [selectedRole, setSelectedRole] = useState<number>(0);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'assign' | 'change' | 'revoke';
    address?: string;
    currentRole?: number;
    newRole?: number;
  }>({ isOpen: false, type: 'assign' });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const role = await getUserRole();
      setCurrentUserRole(role);
      
      if (role === 2) {
        const roles = await getAllRoles();
        setRoleAssignments(roles);
      }
    } catch (error) {
      console.error('Failed to load role data:', error);
    }
  };

  const validateStellarAddress = (addr: string): boolean => {
    return /^G[A-Z0-9]{55}$/.test(addr);
  };

  const handleAssignRole = () => {
    if (!validateStellarAddress(newAddress)) {
      showToast('Invalid Stellar address format', 'error');
      return;
    }

    const existing = roleAssignments.find(r => r.address === newAddress);
    if (existing) {
      showToast('Address already has a role. Use Change Role instead.', 'warning');
      return;
    }

    setConfirmModal({
      isOpen: true,
      type: 'assign',
      address: newAddress,
      newRole: selectedRole
    });
  };

  const handleChangeRole = (address: string, currentRole: number) => {
    setConfirmModal({
      isOpen: true,
      type: 'change',
      address,
      currentRole,
      newRole: currentRole
    });
  };

  const handleRevokeRole = (address: string, currentRole: number) => {
    setConfirmModal({
      isOpen: true,
      type: 'revoke',
      address,
      currentRole
    });
  };

  const executeRoleChange = async () => {
    try {
      const { type, address, newRole } = confirmModal;
      
      if (!address) return;

      if (type === 'revoke') {
        await setRole(address, 0);
        showToast('Role revoked successfully', 'success');
      } else {
        await setRole(address, newRole ?? 0);
        showToast(`Role ${type === 'assign' ? 'assigned' : 'changed'} successfully`, 'success');
      }

      if (type === 'assign') {
        setNewAddress('');
        setSelectedRole(0);
      }

      await loadData();
    } catch (error: any) {
      showToast(error.message || 'Failed to update role', 'error');
    } finally {
      setConfirmModal({ isOpen: false, type: 'assign' });
    }
  };

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

      {/* Role Statistics */}
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

      {/* Assign Role Form */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <UserPlus size={20} />
          Assign Role
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
          disabled={loading || !newAddress}
          className="mt-4 w-full md:w-auto px-6 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors min-h-[44px]"
        >
          Assign Role
        </button>
      </div>

      {/* Current Assignments */}
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Users size={20} />
            Current Assignments ({filteredAssignments.length})
          </h3>
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="Search address or role..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-4 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 w-full md:w-64 min-h-[44px]"
            />
          </div>
        </div>

        {filteredAssignments.length === 0 ? (
          <p className="text-center text-gray-400 py-8">No role assignments found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Address</th>
                  <th className="text-left py-3 px-4 text-sm font-medium text-gray-400">Role</th>
                  <th className="text-right py-3 px-4 text-sm font-medium text-gray-400">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredAssignments.map((assignment) => (
                  <tr key={assignment.address} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                    <td className="py-3 px-4">
                      <span className="font-mono text-sm" title={assignment.address}>
                        {assignment.address.slice(0, 8)}...{assignment.address.slice(-8)}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span className={`font-medium ${ROLES[assignment.role as keyof typeof ROLES]?.color}`}>
                        {ROLES[assignment.role as keyof typeof ROLES]?.name}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={() => handleChangeRole(assignment.address, assignment.role)}
                          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors min-h-[36px] min-w-[36px]"
                        >
                          Change
                        </button>
                        <button
                          onClick={() => handleRevokeRole(assignment.address, assignment.role)}
                          className="px-3 py-1.5 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-sm rounded-lg transition-colors min-h-[36px] min-w-[36px]"
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

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        title={
          confirmModal.type === 'assign' ? 'Assign Role' :
          confirmModal.type === 'change' ? 'Change Role' :
          'Revoke Role'
        }
        message={
          confirmModal.type === 'assign' 
            ? `Assign ${ROLES[confirmModal.newRole as keyof typeof ROLES]?.name} role to ${confirmModal.address?.slice(0, 8)}...${confirmModal.address?.slice(-8)}?`
            : confirmModal.type === 'change'
            ? `Change role for ${confirmModal.address?.slice(0, 8)}...${confirmModal.address?.slice(-8)}?`
            : `Revoke ${ROLES[confirmModal.currentRole as keyof typeof ROLES]?.name} role from ${confirmModal.address?.slice(0, 8)}...${confirmModal.address?.slice(-8)}? This will set their role to Member.`
        }
        confirmText={confirmModal.type === 'revoke' ? 'Revoke' : 'Confirm'}
        onConfirm={executeRoleChange}
        onCancel={() => setConfirmModal({ isOpen: false, type: 'assign' })}
        isDestructive={confirmModal.type === 'revoke'}
      />

      {confirmModal.type === 'change' && confirmModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black bg-opacity-50">
          <div className="bg-gray-800 rounded-xl border border-gray-700 w-full max-w-md">
            <div className="p-6 border-b border-gray-700">
              <h3 className="text-xl font-bold">Change Role</h3>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-gray-300">
                Select new role for {confirmModal.address?.slice(0, 8)}...{confirmModal.address?.slice(-8)}
              </p>
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
              <button
                onClick={() => setConfirmModal({ isOpen: false, type: 'assign' })}
                className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg font-medium transition-colors min-h-[44px] sm:min-h-0"
              >
                Cancel
              </button>
              <button
                onClick={executeRoleChange}
                className="w-full sm:w-auto px-6 py-3 sm:py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors min-h-[44px] sm:min-h-0"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagement;
