import type { ContractEvent } from "../events.types.js";
import type {
  NormalizedEvent,
  ReputationUpdatedData,
  BatchExecutedData,
  RetryScheduledData,
  RetryAttemptedData,
  RetriesExhaustedData,
  TokensLockedData,
  LockExtendedData,
  TokensUnlockedData,
  EarlyUnlockData,
  GasLimitExceededData,
  CrossVaultProposedData,
  CrossVaultExecutedData,
  ConfigUpdatedData,
  OracleConfigUpdatedData,
  FundingRoundApprovedData,
  FundingRoundCancelledData,
  FundingRoundCompletedData,
} from "../types.js";
import { EventType } from "../types.js";

function id1(event: ContractEvent): string {
  return String(event.topic[1] ?? "0");
}

function meta(event: ContractEvent) {
  return {
    id: event.id,
    contractId: event.contractId,
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
  };
}

export class MiscNormalizer {
  static normalizeReputationUpdated(event: ContractEvent): NormalizedEvent<ReputationUpdatedData> {
    const d = event.value;
    return {
      type: EventType.REPUTATION_UPDATED,
      data: {
        address: String(d[0] ?? ""),
        oldScore: Number(d[1] ?? 0),
        newScore: Number(d[2] ?? 0),
        reason: String(d[3] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeBatchExecuted(event: ContractEvent): NormalizedEvent<BatchExecutedData> {
    const d = event.value;
    return {
      type: EventType.BATCH_EXECUTED,
      data: {
        batchId: id1(event),
        executor: String(d[0] ?? ""),
        count: Number(d[1] ?? 0),
        successCount: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeRetryScheduled(event: ContractEvent): NormalizedEvent<RetryScheduledData> {
    const d = event.value;
    return {
      type: EventType.RETRY_SCHEDULED,
      data: {
        targetId: String(d[0] ?? ""),
        retryAt: Number(d[1] ?? 0),
        attemptNumber: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeRetryAttempted(event: ContractEvent): NormalizedEvent<RetryAttemptedData> {
    const d = event.value;
    return {
      type: EventType.RETRY_ATTEMPTED,
      data: {
        targetId: String(d[0] ?? ""),
        attemptNumber: Number(d[1] ?? 0),
        success: Boolean(d[2] ?? false),
      },
      metadata: meta(event),
    };
  }

  static normalizeRetriesExhausted(event: ContractEvent): NormalizedEvent<RetriesExhaustedData> {
    const d = event.value;
    return {
      type: EventType.RETRIES_EXHAUSTED,
      data: {
        targetId: String(d[0] ?? ""),
        maxAttempts: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeTokensLocked(event: ContractEvent): NormalizedEvent<TokensLockedData> {
    const d = event.value;
    return {
      type: EventType.TOKENS_LOCKED,
      data: {
        address: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        token: String(d[2] ?? ""),
        unlockLedger: Number(d[3] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeLockExtended(event: ContractEvent): NormalizedEvent<LockExtendedData> {
    const d = event.value;
    return {
      type: EventType.LOCK_EXTENDED,
      data: {
        address: String(d[0] ?? ""),
        token: String(d[1] ?? ""),
        newUnlockLedger: Number(d[2] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeTokensUnlocked(event: ContractEvent): NormalizedEvent<TokensUnlockedData> {
    const d = event.value;
    return {
      type: EventType.TOKENS_UNLOCKED,
      data: {
        address: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        token: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeEarlyUnlock(event: ContractEvent): NormalizedEvent<EarlyUnlockData> {
    const d = event.value;
    return {
      type: EventType.EARLY_UNLOCK,
      data: {
        address: String(d[0] ?? ""),
        amount: String(d[1] ?? "0"),
        token: String(d[2] ?? ""),
        penalty: String(d[3] ?? "0"),
      },
      metadata: meta(event),
    };
  }

  static normalizeGasLimitExceeded(event: ContractEvent): NormalizedEvent<GasLimitExceededData> {
    const d = event.value;
    return {
      type: EventType.GAS_LIMIT_EXCEEDED,
      data: {
        proposalId: id1(event),
        gasUsed: Number(d[0] ?? 0),
        gasLimit: Number(d[1] ?? 0),
      },
      metadata: meta(event),
    };
  }

  static normalizeCrossVaultProposed(event: ContractEvent): NormalizedEvent<CrossVaultProposedData> {
    const d = event.value;
    return {
      type: EventType.CROSS_VAULT_PROPOSED,
      data: {
        proposalId: id1(event),
        sourceVault: String(d[0] ?? ""),
        targetVault: String(d[1] ?? ""),
        amount: String(d[2] ?? "0"),
        token: String(d[3] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeCrossVaultExecuted(event: ContractEvent): NormalizedEvent<CrossVaultExecutedData> {
    const d = event.value;
    return {
      type: EventType.CROSS_VAULT_EXECUTED,
      data: {
        proposalId: id1(event),
        sourceVault: String(d[0] ?? ""),
        targetVault: String(d[1] ?? ""),
        amount: String(d[2] ?? "0"),
        token: String(d[3] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeConfigUpdated(event: ContractEvent): NormalizedEvent<ConfigUpdatedData> {
    const d = event.value;
    return {
      type: EventType.CONFIG_UPDATED,
      data: {
        admin: String(d[0] ?? ""),
        field: String(d[1] ?? ""),
        oldValue: String(d[2] ?? ""),
        newValue: String(d[3] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeOracleConfigUpdated(event: ContractEvent): NormalizedEvent<OracleConfigUpdatedData> {
    const d = event.value;
    return {
      type: EventType.ORACLE_CONFIG_UPDATED,
      data: {
        admin: String(d[0] ?? ""),
        oracle: String(d[1] ?? ""),
        config: String(d[2] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeFundingRoundApproved(event: ContractEvent): NormalizedEvent<FundingRoundApprovedData> {
    const d = event.value;
    return {
      type: EventType.FUNDING_ROUND_APPROVED,
      data: {
        roundId: id1(event),
        proposalId: String(d[0] ?? ""),
        approver: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeFundingRoundCancelled(event: ContractEvent): NormalizedEvent<FundingRoundCancelledData> {
    const d = event.value;
    return {
      type: EventType.FUNDING_ROUND_CANCELLED,
      data: {
        roundId: id1(event),
        cancelledBy: String(d[0] ?? ""),
        reason: String(d[1] ?? ""),
      },
      metadata: meta(event),
    };
  }

  static normalizeFundingRoundCompleted(event: ContractEvent): NormalizedEvent<FundingRoundCompletedData> {
    const d = event.value;
    return {
      type: EventType.FUNDING_ROUND_COMPLETED,
      data: {
        roundId: id1(event),
        recipient: String(d[0] ?? ""),
        totalReleased: String(d[1] ?? "0"),
      },
      metadata: meta(event),
    };
  }
}
