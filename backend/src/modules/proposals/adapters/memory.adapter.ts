/**
 * Proposal Activity Persistence Adapters
 * 
 * Storage adapters for proposal activity records.
 * These are hooks for future persistence integration.
 */

import {
  ProposalActivityRecord,
  ProposalActivitySummary,
  ProposalActivityPersistence,
  ProposalActivityType,
} from "../types.js";

/**
 * In-memory persistence adapter for development and testing.
 * This can be replaced with database adapters in production.
 */
export class MemoryProposalPersistence implements ProposalActivityPersistence {
  private records: Map<string, ProposalActivityRecord[]> = new Map();

  /**
   * Saves a single activity record.
   */
  public async save(record: ProposalActivityRecord): Promise<void> {
    const existing = this.records.get(record.proposalId) ?? [];
    existing.push(record);
    this.records.set(record.proposalId, existing);
  }

  /**
   * Saves multiple activity records in batch.
   */
  public async saveBatch(records: ProposalActivityRecord[]): Promise<void> {
    for (const record of records) {
      await this.save(record);
    }
  }

  /**
   * Gets all activity records for a proposal.
   */
  public async getByProposalId(proposalId: string): Promise<ProposalActivityRecord[]> {
    const records = this.records.get(proposalId);
    return records ? [...records] : [];
  }

  /**
   * Gets all activity records for a contract.
   */
  public async getByContractId(contractId: string): Promise<ProposalActivityRecord[]> {
    const result: ProposalActivityRecord[] = [];

    for (const records of this.records.values()) {
      for (const record of records) {
        if (record.metadata.contractId === contractId) {
          result.push(record);
        }
      }
    }

    return result;
  }

  /**
   * Gets the activity summary for a proposal.
   */
  public async getSummary(proposalId: string): Promise<ProposalActivitySummary | null> {
    const records = this.records.get(proposalId);

    if (!records || records.length === 0) {
      return null;
    }

    // Sort by timestamp
    const sortedRecords = [...records].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const createdRecord = sortedRecords.find(
      (r) => r.type === ProposalActivityType.CREATED
    );
    const latestRecord = sortedRecords[sortedRecords.length - 1];

    return {
      proposalId,
      contractId: latestRecord.metadata.contractId,
      createdAt: createdRecord?.timestamp ?? latestRecord.timestamp,
      lastActivityAt: latestRecord.timestamp,
      totalEvents: records.length,
      currentStatus: latestRecord.type,
      events: sortedRecords,
    };
  }

  /**
   * Clears all stored records.
   */
  public async clear(): Promise<void> {
    this.records.clear();
  }

  /**
   * Gets the count of all records.
   */
  public getCount(): number {
    let total = 0;
    for (const records of this.records.values()) {
      total += records.length;
    }
    return total;
  }

  /**
   * Gets all unique proposal IDs.
   */
  public getProposalIds(): string[] {
    return Array.from(this.records.keys());
  }
}

/**
 * Factory function to create a memory persistence adapter.
 */
export function createMemoryPersistence(): MemoryProposalPersistence {
  return new MemoryProposalPersistence();
}
