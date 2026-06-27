import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  validateEnum,
  validatePagination,
  validateOptionalString,
  validateOptionalInteger,
} from "../../shared/http/validateQuery.js";
import type { RecurringIndexerService } from "./recurring.service.js";
import { RecurringStatus } from "./types.js";

/**
 * Get all recurring payments with optional status filter and pagination
 */
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";

export function getAllRecurringController(
  service: RecurringIndexerService,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (request, response) => {
    const pagination = validatePagination(request, response);
    if (!pagination) return;

    const status = validateEnum(
      request,
      response,
      "status",
      [RecurringStatus.ACTIVE, RecurringStatus.DUE, RecurringStatus.CANCELLED] as const,
    );
    if (status === null) return;

    const contractId = validateOptionalString(request, "contractId");
    const proposer = validateOptionalString(request, "proposer");
    const recipient = validateOptionalString(request, "recipient");

    // Create cache key
    const cacheKey = `recurring:${contractId || 'all'}:${status || 'all'}:${pagination.offset}:${pagination.limit}`;

    try {
      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          success(response, cached);
          return;
        }
      }

      const result = await service.getPayments(
        {
          contractId,
          status: status as RecurringStatus | undefined,
          proposer,
          recipient,
        },
        pagination,
      );

      const payload = {
        data: result.items,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      };

      if (cache) {
        cache.set(cacheKey, payload, 30_000); // 30 seconds TTL
      }

      success(response, payload);
    } catch (err) {
      error(response, {
        message: "Failed to fetch recurring payments",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * Get a single recurring payment by ID
 */
export function getRecurringByIdController(
  service: RecurringIndexerService,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (request, response) => {
    try {
      const paymentId = String(request.params.paymentId);

      // Create cache key
      const cacheKey = `recurring:${paymentId}`;

      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          success(response, cached);
          return;
        }
      }

      const payment = await service.getPayment(paymentId);
      if (!payment) {
        error(response, {
          message: "Payment not found",
          status: 404,
          code: ErrorCode.NOT_FOUND,
        });
        return;
      }

      if (cache) {
        cache.set(cacheKey, payment, 30_000); // 30 seconds TTL
      }

      success(response, payment);
    } catch (err) {
      error(response, {
        message: "Failed to fetch recurring payment",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * Get payments due within the next lookaheadLedgers ledgers.
 * lookaheadLedgers: 1–17280, default 1440
 */
export function getDueWithLookaheadController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (request, response) => {
    const lookaheadRaw = validateOptionalInteger(
      request,
      response,
      "lookaheadLedgers",
      { min: 1, max: 17280 },
    );
    if (lookaheadRaw === null) return;
    const lookaheadLedgers = lookaheadRaw ?? 1440;

    const { lastLedgerProcessed } = service.getStatus();
    const targetLedger = lastLedgerProcessed + lookaheadLedgers;

    try {
      const all = await service.getDuePaymentsAtLedger(targetLedger);
      const pagination = validatePagination(request, response);
      if (!pagination) return;
      const data = all.slice(pagination.offset, pagination.offset + pagination.limit);
      success(response, {
        data,
        total: all.length,
        offset: pagination.offset,
        limit: pagination.limit,
        lookaheadLedgers,
        targetLedger,
      });
    } catch (err) {
      error(response, {
        message: "Failed to fetch due payments",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

export function getDueRecurringController(
  service: RecurringIndexerService,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (request, response) => {
    const pagination = validatePagination(request, response);
    if (!pagination) return;

    // Get current ledger from indexer status
    const { lastLedgerProcessed } = service.getStatus();
    
    // Create cache key
    const cacheKey = `recurring:overdue:${pagination.offset}:${pagination.limit}`;
    
    try {
      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          success(response, cached);
          return;
        }
      }

      // Get all payments and filter for overdue ones
      const all = await service.getPayments(undefined, undefined, lastLedgerProcessed);
      const overduePayments = all.items.filter(payment => 
        payment.computedStatus === "overdue"
      ).sort((a, b) => a.ledgersUntilDue - b.ledgersUntilDue); // Most overdue first (most negative)
      
      const data = overduePayments.slice(pagination.offset, pagination.offset + pagination.limit);
      
      const payload = {
        data,
        total: overduePayments.length,
        offset: pagination.offset,
        limit: pagination.limit,
      };
      
      if (cache) {
        cache.set(cacheKey, payload, 30_000); // 30 seconds TTL
      }
      
      success(response, payload);
    } catch (err) {
      error(response, {
        message: "Failed to fetch overdue payments",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

// Backward-compatible alias used by older imports/tests.
export const getDuePaymentsController = getDueRecurringController;
export const getOverdueRecurringController = getDueRecurringController;

/**
 * POST /api/v1/recurring/check-conflict
 * Accepts proposed payment params, returns list of similar active payments.
 * Body: { recipient, amount, intervalLedgers }
 */
export function checkConflictController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (request, response) => {
    const { recipient, amount, intervalLedgers } = request.body as {
      recipient?: unknown;
      amount?: unknown;
      intervalLedgers?: unknown;
    };

    if (typeof recipient !== "string" || !recipient) {
      error(response, { message: "recipient is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }
    if (typeof amount !== "string" && typeof amount !== "number") {
      error(response, { message: "amount is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }
    if (typeof intervalLedgers !== "number" || !Number.isInteger(intervalLedgers) || intervalLedgers <= 0) {
      error(response, { message: "intervalLedgers must be a positive integer", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }

    try {
      const conflicts = await service.checkConflicts({
        recipient,
        amount: String(amount),
        intervalLedgers,
      });
      success(response, {
        conflicts,
        is_duplicate_risk: conflicts.length > 0,
      });
    } catch (err) {
      error(response, {
        message: "Conflict check failed",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}

/**
 * POST /api/v1/recurring (create with conflict warning header)
 * ?force=true bypasses the warning.
 */
export function createRecurringController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (request, response) => {
    const force = request.query["force"] === "true";
    const { recipient, amount, intervalLedgers } = request.body as {
      recipient?: unknown;
      amount?: unknown;
      intervalLedgers?: unknown;
    };

    if (typeof recipient !== "string" || !recipient) {
      error(response, { message: "recipient is required", status: 400, code: ErrorCode.VALIDATION_ERROR });
      return;
    }

    // Non-blocking conflict check
    try {
      if (!force && typeof amount === "string" && typeof intervalLedgers === "number") {
        const conflicts = await service.checkConflicts({
          recipient,
          amount,
          intervalLedgers,
        });
        if (conflicts.length > 0) {
          response.setHeader("X-Conflict-Warning", "true");
        }
      }
    } catch {
      // Conflict detection failure is non-blocking
    }

    // Placeholder: actual creation would persist via storage
    success(response, { created: true, message: "Payment created (stub — wire to storage)" });
  };
}

/**
 * Get recurring payment execution history
 * GET /api/v1/recurring/:id/history
 */
export function getRecurringHistoryController(
  service: RecurringIndexerService,
  cache?: CacheAdapter<unknown>,
): RequestHandler {
  return async (request, response) => {
    try {
      const paymentId = String(request.params.paymentId);

      // Create cache key
      const cacheKey = `recurring:${paymentId}:history`;

      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          success(response, cached);
          return;
        }
      }

      const payment = await service.getPayment(paymentId);
      if (!payment) {
        error(response, {
          message: "Payment not found",
          status: 404,
          code: ErrorCode.NOT_FOUND,
        });
        return;
      }

      // Return the events array as history
      const payload = {
        data: payment.events,
        total: payment.events.length,
      };

      if (cache) {
        cache.set(cacheKey, payload, 30_000); // 30 seconds TTL
      }

      success(response, payload);
    } catch (err) {
      error(response, {
        message: "Failed to fetch payment history",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}


/**
 * Trigger a manual sync cycle.
 * Returns { synced: number, durationMs: number }.
 * Returns 409 if a sync is already in progress.
 */
export function triggerSyncController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (_request, response) => {
    if (service.isSyncing()) {
      error(response, {
        message: "Sync already in progress",
        status: 409,
        code: ErrorCode.BAD_REQUEST,
      });
      return;
    }
    try {
      const start = Date.now();
      await service.sync();
      success(response, { synced: service.getStatus().totalPaymentsIndexed, durationMs: Date.now() - start });
    } catch (err) {
      error(response, {
        message: "Sync failed",
        status: 500,
        code: ErrorCode.INTERNAL_ERROR,
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}
