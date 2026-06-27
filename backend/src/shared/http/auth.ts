import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { error } from "./response.js";
import { ErrorCode } from "./errorCodes.js";

type AuthKeyState = {
  primaryKey?: string;
  nextKey?: string;
};

type AuthKeyStateProvider = () => AuthKeyState;

function resolveState(
  apiKeyOrProvider: string | undefined | AuthKeyStateProvider,
  nextApiKey?: string,
): AuthKeyState {
  if (typeof apiKeyOrProvider === "function") {
    return apiKeyOrProvider();
  }

  return {
    primaryKey: apiKeyOrProvider,
    nextKey: nextApiKey,
  };
}

function isValidKey(providedKey: string, expectedKey: string): boolean {
  try {
    const bufferProvided = Buffer.from(providedKey);
    const bufferActual = Buffer.from(expectedKey);

    return (
      bufferProvided.length === bufferActual.length &&
      crypto.timingSafeEqual(bufferProvided, bufferActual)
    );
  } catch {
    return false;
  }
}

/**
 * Middleware that validates the Authorization: Bearer header against the configured API keys.
 * 
 * Uses constant-time comparison to prevent timing attacks.
 * 
 * Accepts both the current key and an optional transition key to allow zero-downtime key rotation.
 *
 * @param apiKeyOrProvider The primary API key or a provider for dynamic key state
 * @param nextApiKey Optional transition API key
 * @param onOldKeyUsed Optional callback invoked when old/primary key is used during pending rotation
 * @returns Express middleware function
 */
export function createAuthMiddleware(
  apiKeyOrProvider: string | undefined | AuthKeyStateProvider,
  nextApiKey?: string,
  onOldKeyUsed?: () => void,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const state = resolveState(apiKeyOrProvider, nextApiKey);
    const primaryKey = state.primaryKey;
    const transitionKey = state.nextKey;

    // If no API key is configured, allow the request
    // This is useful for development environments where auth might be optional
    if (!primaryKey && !transitionKey) {
      return next();
    }

    const authHeader = req.get("Authorization");

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return error(res, {
        message: "Unauthorized: Missing or invalid Authorization header",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    const providedKey = authHeader.substring(7); // "Bearer " is 7 chars

    if (primaryKey && isValidKey(providedKey, primaryKey)) {
      if (transitionKey) {
        onOldKeyUsed?.();
      }
      return next();
    }

    if (transitionKey && isValidKey(providedKey, transitionKey)) {
      return next();
    }

    return error(res, {
      message: "Unauthorized: Invalid API key",
      status: 401,
      code: ErrorCode.UNAUTHORIZED,
    });
  };
}

function resolvePrimaryApiKey(
  apiKeyOrProvider: string | undefined | (() => string | undefined),
): string | undefined {
  if (typeof apiKeyOrProvider === "function") {
    return apiKeyOrProvider();
  }

  return apiKeyOrProvider;
}

/**
 * Middleware that requires API key authentication for admin endpoints.
 *
 * Accepts API key via:
 * - Authorization: Bearer <key>
 * - X-API-Key: <key>
 *
 * Uses constant-time comparison to prevent timing attacks.
 *
 * Returns:
 * - 401 if auth header is missing
 * - 403 if API key is invalid (distinguishes from missing)
 * - Allows request if no API key is configured (development mode)
 *
 * NOTE: This middleware intentionally accepts only the current primary key,
 * never the transition key used by public route auth during rotations.
 *
 * @param apiKeyOrProvider The current primary API key or provider
 * @returns Express middleware function
 */
export function requireApiKey(
  apiKeyOrProvider: string | undefined | (() => string | undefined),
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = resolvePrimaryApiKey(apiKeyOrProvider);

    // If no API key is configured, allow the request (development mode)
    if (!apiKey) {
      return next();
    }

    // Check both Authorization: Bearer and X-API-Key headers
    const authHeader = req.get("Authorization");
    const apiKeyHeader = req.get("X-API-Key");

    let providedKey: string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      providedKey = authHeader.substring(7); // "Bearer " is 7 chars
    } else if (apiKeyHeader) {
      providedKey = apiKeyHeader;
    }

    // Missing authentication
    if (!providedKey) {
      return error(res, {
        message: "Unauthorized: Missing authentication. Provide API key via Authorization: Bearer <key> or X-API-Key: <key> header",
        status: 401,
        code: ErrorCode.UNAUTHORIZED,
      });
    }

    if (isValidKey(providedKey, apiKey)) {
        return next();
    }

    // Invalid API key - return 403 to distinguish from missing auth
    return error(res, {
      message: "Forbidden: Invalid API key",
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  };
}
