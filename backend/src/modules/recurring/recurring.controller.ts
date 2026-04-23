import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { RecurringIndexerService } from "./recurring.service.js";
import type { RecurringStatus } from "./types.js";

/**
 * Get all recurring payments with optional status filter and pagination
 */
export function getAllRecurringController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (request, response) => {
    try {
      const status = request.query.status as string | undefined;
      const offset = Math.max(
        0,
        parseInt(String(request.query.offset ?? "0"), 10) || 0,
      );
      const rawLimit = parseInt(String(request.query.limit ?? "50"), 10) || 50;
      const limit = Math.min(Math.max(1, rawLimit), 200);

      const filter = status ? { status: status as RecurringStatus } : undefined;
      const result = await service.getPayments(filter, { offset, limit });

      success(response, result);
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
): RequestHandler {
  return async (request, response) => {
    try {
      const id = String(request.params.id);

      const payment = await service.getPayment(id);
      if (!payment) {
        error(response, {
          message: "Payment not found",
          status: 404,
          code: ErrorCode.NOT_FOUND,
        });
        return;
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
 * Get all payments currently due
 */
export function getDueRecurringController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (_request, response) => {
    try {
      const payments = await service.getDuePayments();

      success(response, {
        items: payments,
        total: payments.length,
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
