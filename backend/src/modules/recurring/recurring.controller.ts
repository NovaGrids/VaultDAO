import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import type { RecurringIndexerService } from "./recurring.service.js";
import type { RecurringStatus } from "./types.js";

/**
 * Get all recurring payments with optional status filter
 */
export function getAllRecurringController(
  service: RecurringIndexerService,
): RequestHandler {
  return async (request, response) => {
    try {
      const status = request.query.status as string | undefined;

      const filter = status ? { status: status as RecurringStatus } : undefined;
      const payments = await service.getPayments(filter);

      success(response, {
        items: payments,
        total: payments.length,
      });
    } catch (err) {
      error(response, {
        message: "Failed to fetch recurring payments",
        status: 500,
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
        error(response, { message: "Payment not found", status: 404 });
        return;
      }

      success(response, payment);
    } catch (err) {
      error(response, {
        message: "Failed to fetch recurring payment",
        status: 500,
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
        details: err instanceof Error ? err.message : undefined,
      });
    }
  };
}
