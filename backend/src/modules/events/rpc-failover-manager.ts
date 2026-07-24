/**
 * RpcFailoverManager
 *
 * Manages per-endpoint cursor tracking and safe failover between Soroban RPC
 * endpoints. The central problem this solves: different RPC nodes can have
 * diverging views of the chain (different indexing lag, different history
 * depth, minor reorgs). Blindly carrying a primary cursor onto a backup
 * endpoint can skip events or replay stale ones.
 *
 * ## Algorithm
 *
 * 1. Each endpoint gets its own `EventCursor` entry in `endpointCursors`.
 * 2. Before failing over, fetch the last `VALIDATION_WINDOW` event IDs from
 *    both endpoints around the primary's cursor position.
 * 3. If they agree → consistent, carry the cursor over and continue.
 * 4. If they diverge → walk backwards (bounded by `MAX_LOOKBACK`) to find
 *    the most recent event ID seen by both endpoints.
 * 5. Resume from that common point on the backup. If no common point is
 *    found within the lookback bound, throw a `ServiceUnavailableError` so
 *    the polling loop's exponential-backoff handler surfaces the problem
 *    rather than silently resuming from an incorrect position.
 */

import { createLogger } from "../../shared/logging/logger.js";
import { SorobanRpcClient } from "../../shared/rpc/soroban-rpc.client.js";
import { ServiceUnavailableError } from "../../shared/errors/AppError.js";
import type { EventCursor } from "./cursor/cursor.types.js";

const logger = createLogger("rpc-failover-manager");

/**
 * Number of recent events fetched from each endpoint during the consistency
 * check. Kept small to bound latency on every failover.
 */
export const VALIDATION_WINDOW = 20;

/**
 * Maximum number of ledgers to walk backwards when searching for a common
 * prefix. Equates to at most VALIDATION_WINDOW * MAX_LOOKBACK_STEPS event
 * fetches total, which is well-bounded.
 */
export const MAX_LOOKBACK_STEPS = 5;

/**
 * Ledger stride used for each backwards step during the common-prefix search.
 * Walking back VALIDATION_WINDOW ledgers per step keeps the search efficient.
 */
const LOOKBACK_STRIDE_LEDGERS = VALIDATION_WINDOW;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EndpointInfo {
  readonly url: string;
  readonly client: SorobanRpcClient;
}

/**
 * Result of a failover decision: the endpoint to use and the cursor to start
 * from on that endpoint.
 */
export interface FailoverResult {
  /** The backup endpoint that the caller should switch to. */
  readonly endpoint: EndpointInfo;
  /** Cursor position to resume from on the backup endpoint. */
  readonly cursor: EventCursor;
  /**
   * True when the common prefix was found within the lookback window.
   * False when the backup's latest state already agrees with the primary's
   * cursor (no divergence detected, fast path).
   */
  readonly resynced: boolean;
}

// ─── RpcFailoverManager ───────────────────────────────────────────────────────

export class RpcFailoverManager {
  /**
   * Per-endpoint cursor map, keyed by endpoint URL.
   * Each endpoint independently tracks the last ledger it successfully
   * processed so that switching between them never conflates positions.
   */
  private readonly endpointCursors: Map<string, EventCursor> = new Map();

  /**
   * Index of the currently-active endpoint in `endpoints`.
   */
  private activeIndex = 0;

  constructor(private readonly endpoints: EndpointInfo[]) {
    if (endpoints.length === 0) {
      throw new Error("RpcFailoverManager requires at least one endpoint");
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  /** Returns the currently active endpoint. */
  public getActiveEndpoint(): EndpointInfo {
    return this.endpoints[this.activeIndex]!;
  }

  /** Returns the RPC client for the currently active endpoint. */
  public getActiveClient(): SorobanRpcClient {
    return this.getActiveEndpoint().client;
  }

  /**
   * Returns the cursor for the given endpoint URL, or null if no cursor has
   * been recorded yet for that endpoint.
   */
  public getCursorForEndpoint(url: string): EventCursor | null {
    return this.endpointCursors.get(url) ?? null;
  }

  /**
   * Records a successfully processed cursor position for the given endpoint.
   * This is called by the polling loop after each successful poll so that the
   * per-endpoint state stays up to date.
   */
  public setCursorForEndpoint(url: string, cursor: EventCursor): void {
    this.endpointCursors.set(url, cursor);
  }

  /** Returns all endpoint URLs and their latest known cursors. */
  public getAllEndpointCursors(): Array<{ url: string; cursor: EventCursor | null }> {
    return this.endpoints.map((ep) => ({
      url: ep.url,
      cursor: this.endpointCursors.get(ep.url) ?? null,
    }));
  }

  // ── Failover ────────────────────────────────────────────────────────────────

  /**
   * Attempts a safe failover from the current active endpoint to the next
   * available backup.
   *
   * Steps:
   *   1. Pick the next endpoint in round-robin order.
   *   2. Validate cursor consistency between primary and backup.
   *   3. If consistent → return the primary's cursor for use on the backup.
   *   4. If diverged → emit a warning, find the common prefix, return it.
   *   5. If no common prefix found → throw ServiceUnavailableError.
   *
   * @param primaryCursor The primary's last successfully persisted cursor.
   * @param contractId    Contract ID used for event fetches during validation.
   */
  public async failover(
    primaryCursor: EventCursor,
    contractId: string,
  ): Promise<FailoverResult> {
    if (this.endpoints.length === 1) {
      throw new ServiceUnavailableError(
        "RPC failover attempted but no backup endpoints are configured",
      );
    }

    const primaryEndpoint = this.getActiveEndpoint();

    // Advance to the next endpoint (round-robin).
    this.activeIndex = (this.activeIndex + 1) % this.endpoints.length;
    const backupEndpoint = this.getActiveEndpoint();

    logger.info("attempting RPC failover", {
      from: primaryEndpoint.url,
      to: backupEndpoint.url,
      primaryCursor: primaryCursor.lastLedger,
    });

    // Step 2–4: validate consistency and resync if needed.
    const cursor = await this.validateAndResync(
      primaryEndpoint,
      backupEndpoint,
      primaryCursor,
      contractId,
    );

    return {
      endpoint: backupEndpoint,
      cursor,
      resynced: cursor.lastLedger !== primaryCursor.lastLedger,
    };
  }

  // ── Validation & resync ────────────────────────────────────────────────────

  /**
   * Validates cursor consistency between primary and backup, then returns the
   * safe cursor position to resume from on the backup.
   *
   * If both endpoints agree on the last VALIDATION_WINDOW events immediately
   * before `primaryCursor.lastLedger`, the primary's cursor is returned
   * unchanged (fast path).
   *
   * If they disagree, the method walks backwards from the primary's cursor to
   * find the most recent common event ID.
   */
  private async validateAndResync(
    primary: EndpointInfo,
    backup: EndpointInfo,
    primaryCursor: EventCursor,
    contractId: string,
  ): Promise<EventCursor> {
    const primaryIds = await this.fetchRecentEventIds(
      primary.client,
      primaryCursor.lastLedger,
      contractId,
    );

    const backupIds = await this.fetchRecentEventIds(
      backup.client,
      primaryCursor.lastLedger,
      contractId,
    );

    const commonId = findCommonSuffix(primaryIds, backupIds);

    if (commonId !== null && primaryIds[primaryIds.length - 1] === backupIds[backupIds.length - 1]) {
      // Fast path: both endpoints agree on the most recent event.
      logger.info("cursor consistency validated, no divergence detected", {
        primary: primary.url,
        backup: backup.url,
        ledger: primaryCursor.lastLedger,
      });
      return primaryCursor;
    }

    // Cursors have diverged — emit the mandatory warning.
    const divergencePoint = commonId ?? "none";
    logger.warn("cursor divergence detected between RPC endpoints", {
      primary: primary.url,
      backup: backup.url,
      primaryCursorLedger: primaryCursor.lastLedger,
      divergencePoint,
      primaryRecentEventCount: primaryIds.length,
      backupRecentEventCount: backupIds.length,
    });

    // Fast-path: a common point was already found within the validation window.
    if (commonId !== null) {
      const ledger = await this.ledgerForEventId(
        backup.client,
        commonId,
        primaryCursor.lastLedger,
        contractId,
      );
      logger.info("resuming from common prefix found in validation window", {
        backup: backup.url,
        commonEventId: commonId,
        ledger,
      });
      return {
        lastLedger: ledger,
        lastEventId: commonId,
        updatedAt: new Date().toISOString(),
      };
    }

    // Walk backwards to find the common prefix.
    return this.findCommonPrefixWithLookback(
      primary,
      backup,
      primaryCursor,
      contractId,
    );
  }

  /**
   * Walks backwards from `primaryCursor.lastLedger` in steps of
   * `LOOKBACK_STRIDE_LEDGERS` ledgers, up to `MAX_LOOKBACK_STEPS` iterations,
   * fetching events from both endpoints at each step to find a matching event
   * ID.
   *
   * Throws `ServiceUnavailableError` if no common point is found within the
   * lookback bound.
   */
  private async findCommonPrefixWithLookback(
    primary: EndpointInfo,
    backup: EndpointInfo,
    primaryCursor: EventCursor,
    contractId: string,
  ): Promise<EventCursor> {
    let searchLedger = primaryCursor.lastLedger;

    for (let step = 0; step < MAX_LOOKBACK_STEPS; step++) {
      searchLedger = Math.max(1, searchLedger - LOOKBACK_STRIDE_LEDGERS);

      const primaryIds = await this.fetchRecentEventIds(
        primary.client,
        searchLedger,
        contractId,
      );
      const backupIds = await this.fetchRecentEventIds(
        backup.client,
        searchLedger,
        contractId,
      );

      const commonId = findCommonSuffix(primaryIds, backupIds);

      if (commonId !== null) {
        const ledger = await this.ledgerForEventId(
          backup.client,
          commonId,
          searchLedger,
          contractId,
        );
        logger.info("common prefix found during lookback walk", {
          primary: primary.url,
          backup: backup.url,
          step,
          searchLedger,
          commonEventId: commonId,
          resumeLedger: ledger,
        });
        return {
          lastLedger: ledger,
          lastEventId: commonId,
          updatedAt: new Date().toISOString(),
        };
      }

      // If we've reached ledger 1, stop — nothing further to walk back.
      if (searchLedger <= 1) break;
    }

    // No common point found within the lookback bound.
    logger.warn("no common prefix found within lookback bound — cannot safely resume", {
      primary: primary.url,
      backup: backup.url,
      primaryCursorLedger: primaryCursor.lastLedger,
      stepsSearched: MAX_LOOKBACK_STEPS,
    });

    throw new ServiceUnavailableError(
      `RPC failover aborted: no common event history found between ` +
        `${primary.url} and ${backup.url} within ${MAX_LOOKBACK_STEPS * LOOKBACK_STRIDE_LEDGERS} ledgers ` +
        `of the primary cursor (ledger ${primaryCursor.lastLedger}). ` +
        `Manual intervention required to determine a safe resume point.`,
    );
  }

  /**
   * Fetches the most recent up-to-VALIDATION_WINDOW event IDs from an
   * endpoint, starting from `ledger - VALIDATION_WINDOW + 1` so that the
   * window is anchored at `ledger`.
   */
  private async fetchRecentEventIds(
    client: SorobanRpcClient,
    ledger: number,
    contractId: string,
  ): Promise<string[]> {
    const startLedger = Math.max(1, ledger - VALIDATION_WINDOW + 1);
    try {
      const page = await client.getEventsPage({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
        pagination: { limit: VALIDATION_WINDOW },
      });
      return page.events.map((e) => e.id);
    } catch (err) {
      logger.warn("failed to fetch events for consistency check", {
        url: (client as any).url ?? "unknown",
        ledger,
        error: err instanceof Error ? err.message : String(err),
      });
      // Return empty array so the caller treats this endpoint as having no
      // overlap — will trigger divergence handling rather than crashing.
      return [];
    }
  }

  /**
   * Given a known event ID, finds the ledger number it belongs to by fetching
   * a small event window from the backup endpoint.
   *
   * Falls back to `anchorLedger` if the event cannot be found (conservative).
   */
  private async ledgerForEventId(
    client: SorobanRpcClient,
    eventId: string,
    anchorLedger: number,
    contractId: string,
  ): Promise<number> {
    const startLedger = Math.max(1, anchorLedger - VALIDATION_WINDOW + 1);
    try {
      const page = await client.getEventsPage({
        startLedger,
        filters: [{ type: "contract", contractIds: [contractId] }],
        pagination: { limit: VALIDATION_WINDOW },
      });
      const match = page.events.find((e) => e.id === eventId);
      return match?.ledger ?? anchorLedger;
    } catch {
      return anchorLedger;
    }
  }
}

// ─── Pure helpers (exported for testing) ─────────────────────────────────────

/**
 * Returns the most recent event ID that appears in both `a` and `b`, or null
 * if there is no overlap.
 *
 * Searches from the end of each array (most recent events first) so that the
 * most recent common point is returned, avoiding unnecessary replay.
 */
export function findCommonSuffix(a: string[], b: string[]): string | null {
  const setB = new Set(b);
  // Walk `a` from the end to find the most recent common ID.
  for (let i = a.length - 1; i >= 0; i--) {
    const id = a[i];
    if (id !== undefined && setB.has(id)) {
      return id;
    }
  }
  return null;
}
