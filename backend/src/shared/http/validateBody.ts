import type { Request, Response } from "express";
import { error } from "./response.js";
import { ErrorCode } from "./errorCodes.js";

/**
 * Validates that the request body is not empty and is JSON-parsable.
 * @returns true if valid, false otherwise (and sends 400 response)
 */
export function validateRequestBody(req: Request, res: Response): boolean {
  // Check if body exists
  if (!req.body) {
    error(res, {
      message: "Request body is required",
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return false;
  }

  // Check if body is empty object or null
  if (
    Object.keys(req.body).length === 0 ||
    (typeof req.body === "object" && req.body === null)
  ) {
    error(res, {
      message: "Request body cannot be empty",
      status: 400,
      code: ErrorCode.BAD_REQUEST,
    });
    return false;
  }

  return true;
}

/**
 * Validates that the request body matches a given type using a type guard.
 * @param req The request object
 * @param res The response object
 * @param typeGuard A type guard function that returns true if the body matches the expected type
 * @param errorMessage Error message to send if validation fails
 * @returns The validated body if valid, undefined otherwise (and sends 400 response)
 */
export function validateBodyWithGuard<T>(
  req: Request,
  res: Response,
  typeGuard: (body: unknown) => body is T,
  errorMessage: string = "Invalid request body"
): T | undefined {
  if (!validateRequestBody(req, res)) {
    return undefined;
  }

  if (!typeGuard(req.body)) {
    error(res, {
      message: errorMessage,
      status: 400,
      code: ErrorCode.VALIDATION_ERROR,
    });
    return undefined;
  }

  return req.body as T;
}

/**
 * Validates that the request body has required properties.
 * @param req The request object
 * @param res The response object
 * @param requiredProperties Array of property names that must exist in the body
 * @param errorMessage Error message to send if validation fails
 * @returns true if valid, false otherwise (and sends 400 response)
 */
export function validateRequiredBodyProperties(
  req: Request,
  res: Response,
  requiredProperties: string[],
  errorMessage: string = "Missing required properties in request body"
): boolean {
  if (!validateRequestBody(req, res)) {
    return false;
  }

  const missing = requiredProperties.filter(
    (prop) => !(prop in req.body) || req.body[prop] === undefined || req.body[prop] === null
  );

  if (missing.length > 0) {
    error(res, {
      message: `${errorMessage}: ${missing.join(", ")}`,
      status: 400,
      code: ErrorCode.VALIDATION_ERROR,
    });
    return false;
  }

  return true;
}

/**
 * Validates that the request body has required properties with specific types.
 * @param req The request object
 * @param res The response object
 * @param propertyTypes Object mapping property names to their expected types
 * @param errorMessage Error message to send if validation fails
 * @returns true if valid, false otherwise (and sends 400 response)
 */
export function validateBodyPropertyTypes(
  req: Request,
  res: Response,
  propertyTypes: Record<string, string>,
  errorMessage: string = "Invalid property types in request body"
): boolean {
  if (!validateRequestBody(req, res)) {
    return false;
  }

  const invalid = [];
  for (const [prop, expectedType] of Object.entries(propertyTypes)) {
    if (!(prop in req.body)) continue;

    const actualType = typeof req.body[prop];
    if (expectedType === "string" && actualType !== "string") {
      invalid.push(`${prop} (expected string, got ${actualType})`);
    } else if (expectedType === "number" && actualType !== "number") {
      invalid.push(`${prop} (expected number, got ${actualType})`);
    } else if (expectedType === "boolean" && actualType !== "boolean") {
      invalid.push(`${prop} (expected boolean, got ${actualType})`);
    } else if (expectedType === "object" && actualType !== "object") {
      invalid.push(`${prop} (expected object, got ${actualType})`);
    } else if (expectedType === "array" && !Array.isArray(req.body[prop])) {
      invalid.push(`${prop} (expected array, got ${actualType})`);
    }
  }

  if (invalid.length > 0) {
    error(res, {
      message: `${errorMessage}: ${invalid.join(", ")}`,
      status: 400,
      code: ErrorCode.VALIDATION_ERROR,
    });
    return false;
  }

  return true;
}
