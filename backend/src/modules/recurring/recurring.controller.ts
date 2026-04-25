import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import {
  validateEnum,
  validatePagination,
} from "../../shared/http/validateQuery.js";
import type { RecurringIndexerService } from "./recurring.service.js";
import type { RecurringStatus } from "./types.js";

function getSingleQueryString(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = query[key];
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const first = value[0];
    return typeof first === "string" ? first : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

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
      Object.values(RecurringStatus),
    );
    if (status === null) return;

    const contractId = getSingleQueryString(request.query as any, "contractId");
    const proposer = getSingleQueryString(request.query as any, "proposer");
    const recipient = getSingleQueryString(request.query as any, "recipient");

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

    const currentLedgerRaw = getSingleQueryString(
      request.query as any,
      "currentLedger",
    );

    let currentLedger: number | undefined;
    if (currentLedgerRaw !== undefined && currentLedgerRaw !== "") {
      const parsed = Number(currentLedgerRaw);
      if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        error(response, {
          message:
            "Invalid currentLedger: expected a non-negative integer when provided",
          status: 400,
          code: ErrorCode.BAD_REQUEST,
        });
        return;
      }
      currentLedger = parsed;
    }

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
