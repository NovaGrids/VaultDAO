export interface ContractEvent {
  readonly id: string;
  readonly contractId: string;
  readonly topic: readonly string[];
  readonly value: any;
  readonly ledger: number;
  readonly ledgerClosedAt: string;
}

export interface PollingState {
  readonly lastLedgerPolled: number;
  readonly isPolling: boolean;
  readonly errors: number;
}

export interface EventPollingConfig {
  readonly intervalMs: number;
  readonly batchSize: number;
  readonly enabled: boolean;
}
