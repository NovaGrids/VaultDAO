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
export function getAllRecurringController(
  service: RecurringIndexerService,
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

    try {
      const result = await service.getPayments(
        {
          contractId,
          status: status as RecurringStatus | undefined,
          proposer,
          recipient,
        },
        pagination,
      );

      success(response, {
        data: result.items,
        total: result.total,
        offset: result.offset,
        limit: result.limit,
      });
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
      const paymentId = String(request.params.paymentId);

      const payment = await service.getPayment(paymentId);
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
  return async (request, response) => {
    const pagination = validatePagination(request, response);
    if (!pagination) return;

    const currentLedger = validateOptionalInteger(request, response, "currentLedger", { min: 0 });
    if (currentLedger === null) return;

    try {
      const payments =
        currentLedger === undefined
          ? await service.getDuePayments()
          : await service.getDuePaymentsAtLedger(currentLedger);
      const data = payments.slice(
        pagination.offset,
        pagination.offset + pagination.limit,
      );

      success(response, {
        data,
        total: payments.length,
        offset: pagination.offset,
        limit: pagination.limit,
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
