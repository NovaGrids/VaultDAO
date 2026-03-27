/**
 * In-Memory Snapshot Storage Adapter
 * 
 * Simple in-memory implementation of snapshot storage for development and testing.
 */

import type {
  SnapshotStorageAdapter,
  ContractSnapshot,
  SignerSnapshot,
  RoleSnapshot,
  SnapshotStats,
  SnapshotFilter,
  SerializableContractSnapshot,
} from "../types.js";
import { Role } from "../types.js";

/**
 * MemorySnapshotAdapter
 * 
 * In-memory storage for contract snapshots.
 * Not suitable for production use - data is lost on restart.
 */
export class MemorySnapshotAdapter implements SnapshotStorageAdapter {
  private snapshots: Map<string, ContractSnapshot> = new Map();

  /**
   * Get the current snapshot for a contract.
   */
  async getSnapshot(contractId: string): Promise<ContractSnapshot | null> {
    return this.snapshots.get(contractId) ?? null;
  }

  /**
   * Save a snapshot for a contract.
   */
  async saveSnapshot(snapshot: ContractSnapshot): Promise<void> {
    this.snapshots.set(snapshot.contractId, snapshot);
  }

  /**
   * Clear snapshot for a contract.
   */
  async clearSnapshot(contractId: string): Promise<void> {
    this.snapshots.delete(contractId);
  }

  /**
   * Get all signers for a contract.
   */
  async getSigners(contractId: string, filter?: SnapshotFilter): Promise<SignerSnapshot[]> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) {
      return [];
    }

    let signers = Array.from(snapshot.signers.values());

    if (filter) {
      signers = this.applySignerFilter(signers, filter);
    }

    return signers;
  }

  /**
   * Get all role assignments for a contract.
   */
  async getRoles(contractId: string, filter?: SnapshotFilter): Promise<RoleSnapshot[]> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) {
      return [];
    }

    let roles = Array.from(snapshot.roles.values());

    if (filter) {
      roles = this.applyRoleFilter(roles, filter);
    }

    return roles;
  }

  /**
   * Get a specific signer by address.
   */
  async getSigner(contractId: string, address: string): Promise<SignerSnapshot | null> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) {
      return null;
    }

    return snapshot.signers.get(address) ?? null;
  }

  /**
   * Get a specific role assignment by address.
   */
  async getRole(contractId: string, address: string): Promise<RoleSnapshot | null> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) {
      return null;
    }

    return snapshot.roles.get(address) ?? null;
  }

  /**
   * Get snapshot statistics.
   */
  async getStats(contractId: string): Promise<SnapshotStats | null> {
    const snapshot = await this.getSnapshot(contractId);
    if (!snapshot) {
      return null;
    }

    const signers = Array.from(snapshot.signers.values());
    const activeSigners = signers.filter((s) => s.isActive).length;
    const inactiveSigners = signers.length - activeSigners;

    const roleDistribution: Record<Role, number> = {
      [Role.MEMBER]: 0,
      [Role.TREASURER]: 0,
      [Role.ADMIN]: 0,
    };

    for (const role of snapshot.roles.values()) {
      roleDistribution[role.role]++;
    }

    const snapshotAge = Date.now() - new Date(snapshot.snapshotAt).getTime();

    return {
      totalSigners: snapshot.totalSigners,
      activeSigners,
      inactiveSigners,
      totalRoleAssignments: snapshot.totalRoleAssignments,
      roleDistribution,
      lastProcessedLedger: snapshot.lastProcessedLedger,
      snapshotAge,
    };
  }

  /**
   * Apply filter to signer list.
   */
  private applySignerFilter(signers: SignerSnapshot[], filter: SnapshotFilter): SignerSnapshot[] {
    return signers.filter((signer) => {
      if (filter.role !== undefined && signer.role !== filter.role) {
        return false;
      }
      if (filter.isActive !== undefined && signer.isActive !== filter.isActive) {
        return false;
      }
      if (filter.minLedger !== undefined && signer.addedAtLedger < filter.minLedger) {
        return false;
      }
      if (filter.maxLedger !== undefined && signer.addedAtLedger > filter.maxLedger) {
        return false;
      }
      return true;
    });
  }

  /**
   * Apply filter to role list.
   */
  private applyRoleFilter(roles: RoleSnapshot[], filter: SnapshotFilter): RoleSnapshot[] {
    return roles.filter((role) => {
      if (filter.role !== undefined && role.role !== filter.role) {
        return false;
      }
      if (filter.minLedger !== undefined && role.assignedAtLedger < filter.minLedger) {
        return false;
      }
      if (filter.maxLedger !== undefined && role.assignedAtLedger > filter.maxLedger) {
        return false;
      }
      return true;
    });
  }

  /**
   * Serialize a snapshot for storage/export.
   */
  public static serialize(snapshot: ContractSnapshot): SerializableContractSnapshot {
    return {
      contractId: snapshot.contractId,
      signers: Object.fromEntries(snapshot.signers),
      roles: Object.fromEntries(snapshot.roles),
      lastProcessedLedger: snapshot.lastProcessedLedger,
      lastProcessedEventId: snapshot.lastProcessedEventId,
      snapshotAt: snapshot.snapshotAt,
      totalSigners: snapshot.totalSigners,
      totalRoleAssignments: snapshot.totalRoleAssignments,
    };
  }

  /**
   * Deserialize a snapshot from storage.
   */
  public static deserialize(data: SerializableContractSnapshot): ContractSnapshot {
    return {
      contractId: data.contractId,
      signers: new Map(Object.entries(data.signers)),
      roles: new Map(Object.entries(data.roles)),
      lastProcessedLedger: data.lastProcessedLedger,
      lastProcessedEventId: data.lastProcessedEventId,
      snapshotAt: data.snapshotAt,
      totalSigners: data.totalSigners,
      totalRoleAssignments: data.totalRoleAssignments,
    };
  }

  /**
   * Get all contract IDs with snapshots.
   */
  async getContractIds(): Promise<string[]> {
    return Array.from(this.snapshots.keys());
  }

  /**
   * Clear all snapshots (for testing).
   */
  async clearAll(): Promise<void> {
    this.snapshots.clear();
  }
}
