/**
 * Snapshot Event Normalizer
 * 
 * Normalizes role assignment and signer events for snapshot aggregation.
 */

import type { ContractEvent } from "../events/events.types.js";
import type { NormalizedEvent, EventMetadata } from "../events/types.js";
import { EventType } from "../events/types.js";
import type { RoleAssignedData, SignerAddedData } from "./types.js";

/**
 * SnapshotNormalizer
 * 
 * Handles normalization of role and signer events for snapshot building.
 */
export class SnapshotNormalizer {
  /**
   * Normalize a role_assigned event.
   */
  public static normalizeRoleAssigned(event: ContractEvent): NormalizedEvent<RoleAssignedData> {
    // Event structure: topic = ["role_assigned"], value = [address, role]
    const value = event.value as any;
    
    let address: string;
    let role: number;

    // Handle different value structures
    if (Array.isArray(value)) {
      address = this.extractAddress(value[0]);
      role = this.extractNumber(value[1]);
    } else if (value && typeof value === "object") {
      address = this.extractAddress(value.addr || value.address);
      role = this.extractNumber(value.role);
    } else {
      throw new Error("Invalid role_assigned event structure");
    }

    const metadata: EventMetadata = {
      id: event.id,
      contractId: event.contractId,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
    };

    return {
      type: EventType.ROLE_ASSIGNED,
      data: {
        address,
        role,
      },
      metadata,
    };
  }

  /**
   * Normalize an initialized event to extract initial signers.
   */
  public static normalizeInitialized(event: ContractEvent): NormalizedEvent<SignerAddedData> {
    // Event structure: topic = ["initialized"], value = [admin, threshold]
    const value = event.value as any;
    
    let address: string;

    if (Array.isArray(value)) {
      address = this.extractAddress(value[0]);
    } else if (value && typeof value === "object") {
      address = this.extractAddress(value.admin || value.address);
    } else {
      throw new Error("Invalid initialized event structure");
    }

    const metadata: EventMetadata = {
      id: event.id,
      contractId: event.contractId,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
    };

    return {
      type: EventType.INITIALIZED,
      data: {
        address,
        role: 2, // Admin role
        ledger: event.ledger,
        timestamp: event.ledgerClosedAt,
      },
      metadata,
    };
  }

  /**
   * Extract address from various Soroban value formats.
   */
  private static extractAddress(value: any): string {
    if (typeof value === "string") {
      return value;
    }
    
    if (value && typeof value === "object") {
      // Handle Soroban Address type
      if (value._value) {
        return value._value;
      }
      if (value.value) {
        return value.value;
      }
      // Handle stringified address
      if (value.toString) {
        return value.toString();
      }
    }

    throw new Error(`Unable to extract address from value: ${JSON.stringify(value)}`);
  }

  /**
   * Extract number from various Soroban value formats.
   */
  private static extractNumber(value: any): number {
    if (typeof value === "number") {
      return value;
    }

    if (typeof value === "string") {
      const parsed = parseInt(value, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }

    if (value && typeof value === "object") {
      // Handle Soroban U32 type
      if (typeof value._value === "number") {
        return value._value;
      }
      if (typeof value.value === "number") {
        return value.value;
      }
    }

    throw new Error(`Unable to extract number from value: ${JSON.stringify(value)}`);
  }

  /**
   * Normalize a signer_added event.
   * Extracts address and role from the event value.
   * If role is absent, defaults to Role.MEMBER (0).
   */
  public static normalizeSignerAdded(event: ContractEvent): NormalizedEvent<SignerAddedData> {
    const value = event.value as any;

    let address: string;
    let role: number;

    if (Array.isArray(value)) {
      address = this.extractAddress(value[0]);
      role = value[1] !== undefined ? this.extractNumber(value[1]) : 0;
    } else if (value && typeof value === "object") {
      address = this.extractAddress(value.signer || value.addr || value.address);
      role = value.role !== undefined ? this.extractNumber(value.role) : 0;
    } else {
      throw new Error("Invalid signer_added event structure");
    }

    const metadata: EventMetadata = {
      id: event.id,
      contractId: event.contractId,
      ledger: event.ledger,
      ledgerClosedAt: event.ledgerClosedAt,
    };

    return {
      type: EventType.SIGNER_ADDED,
      data: {
        address,
        role,
        ledger: event.ledger,
        timestamp: event.ledgerClosedAt,
      },
      metadata,
    };
  }

  /**
   * Check if an event is relevant for snapshot building.
   */
  public static isSnapshotEvent(eventType: EventType): boolean {
    return (
      eventType === EventType.ROLE_ASSIGNED ||
      eventType === EventType.INITIALIZED ||
      eventType === EventType.SIGNER_ADDED ||
      eventType === EventType.SIGNER_REMOVED
    );
  }
}
