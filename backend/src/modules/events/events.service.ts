import type { BackendEnv } from "../../config/env.js";
import type { ContractEvent, PollingState } from "./events.types.js";
import type { CursorStorage } from "./cursor/index.js";

/**
 * Shape of a single event entry returned by getContractEvents.
 */
interface RpcEventEntry {
  id: string;
  contractId: string;
  topic: string[];
  value: { xdr: string };
  ledger: number;
  ledgerClosedAt: string;
}

/**
 * Shape of the getContractEvents JSON-RPC response.
 */
interface RpcGetContractEventsResult {
  events: RpcEventEntry[];
  latestLedger: number;
}

interface RpcResponse {
  result?: RpcGetContractEventsResult;
  error?: { code: number; message: string };
}

/**
 * EventPollingService
 *
 * A background service that polls the Soroban RPC for contract events.
 * Supports cursor persistence to resume safely across restarts.
 */
export class EventPollingService {
  private isRunning: boolean = false;
  private timer: NodeJS.Timeout | null = null;
  private lastLedgerPolled: number = 0;
  private consecutiveErrors: number = 0;

  constructor(
    private readonly env: BackendEnv,
    private readonly storage: CursorStorage,
  ) {}

  /**
   * Starts the polling loop if enabled in config.
   */
  public async start(): Promise<void> {
    if (this.isRunning) return;
    if (!this.env.eventPollingEnabled) {
      console.log("[events-service] event polling is disabled in config");
      return;
    }

    const lastCursor = await this.storage.getCursor();
    if (lastCursor) {
      this.lastLedgerPolled = lastCursor.lastLedger;
      console.log(
        `[events-service] resuming from cursor: ledger ${this.lastLedgerPolled}`,
      );
    } else {
      this.lastLedgerPolled = 0;
      console.log(
        "[events-service] no cursor found, starting from default ledger 0",
      );
    }

    this.isRunning = true;
    console.log("[events-service] starting event polling loop");
    console.log(`- rpc: ${this.env.sorobanRpcUrl}`);
    console.log(`- contract: ${this.env.contractId}`);
    console.log(`- interval: ${this.env.eventPollingIntervalMs}ms`);

    this.scheduleNextPoll();
  }

  /**
   * Gracefully stops the polling loop.
   */
  public stop(): void {
    if (!this.isRunning) return;

    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[events-service] stopped event polling loop");
  }

  /**
   * Schedules the next execution of the poll loop.
   */
  private scheduleNextPoll(): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      if (!this.isRunning) return;

      try {
        await this.poll();
        this.consecutiveErrors = 0;
      } catch (error) {
        this.consecutiveErrors++;
        console.error(
          `[events-service] poll error (attempt ${this.consecutiveErrors}):`,
          error,
        );
      } finally {
        this.scheduleNextPoll();
      }
    }, this.env.eventPollingIntervalMs);
  }

  /**
   * Calls the Soroban RPC getContractEvents method and processes results.
   */
  private async poll(): Promise<void> {
    const startLedger = this.lastLedgerPolled + 1;

    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getContractEvents",
      params: {
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [this.env.contractId],
          },
        ],
      },
    });

    const response = await fetch(this.env.sorobanRpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      throw new Error(
        `[events-service] RPC HTTP error: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as RpcResponse;

    if (json.error) {
      throw new Error(
        `[events-service] RPC error ${json.error.code}: ${json.error.message}`,
      );
    }

    const result = json.result;
    if (!result) {
      throw new Error("[events-service] RPC response missing result field");
    }

    const events: ContractEvent[] = (result.events ?? []).map((e) => ({
      id: e.id,
      contractId: e.contractId,
      topic: e.topic,
      value: e.value,
      ledger: e.ledger,
      ledgerClosedAt: e.ledgerClosedAt,
    }));

    if (events.length > 0) {
      this.handleBatch(events);
    }

    // Update lastLedgerPolled to the actual latest ledger from the RPC.
    // This ensures the cursor reflects real chain progress even when there
    // are no events in the range.
    this.lastLedgerPolled = result.latestLedger;

    await this.storage.saveCursor({
      lastLedger: this.lastLedgerPolled,
      updatedAt: new Date().toISOString(),
    });
  }

  /**
   * Processes a batch of events discovered during polling.
   */
  private handleBatch(events: ContractEvent[]): void {
    console.log(
      `[events-service] processing batch of ${events.length} events`,
    );
    for (const event of events) {
      this.processEvent(event);
    }
  }

  /**
   * Specialized event processor/router.
   * Reference: contracts/vault/src/events.rs for event topic structure.
   */
  private processEvent(event: ContractEvent): void {
    const mainTopic = event.topic[0];

    console.log(
      `[events-service] routing event: ${mainTopic} (id: ${event.id})`,
    );

    switch (mainTopic) {
      case "proposal_created":
        this.handleProposalCreated(event);
        break;
      case "proposal_executed":
        this.handleProposalExecuted(event);
        break;
      default:
        console.debug(
          `[events-service] ignoring unhandled event type: ${mainTopic}`,
        );
    }
  }

  private handleProposalCreated(event: ContractEvent): void {
    console.log(
      "[events-service] TODO: persistent indexing for proposal_created",
      event.value,
    );
  }

  private handleProposalExecuted(event: ContractEvent): void {
    console.log(
      "[events-service] TODO: persistent indexing for proposal_executed",
      event.value,
    );
  }

  /**
   * Returns current service state for health monitoring.
   */
  public getStatus(): PollingState {
    return {
      lastLedgerPolled: this.lastLedgerPolled,
      isPolling: this.isRunning,
      errors: this.consecutiveErrors,
    };
  }
}
