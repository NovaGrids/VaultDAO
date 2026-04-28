import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { error } from "./response.js";
import { ErrorCode } from "./errorCodes.js";

/**
 * Middleware that validates the Authorization: Bearer header against the configured API key.
 * 
 * Uses constant-time comparison to prevent timing attacks.
 * 
 * @param apiKey The valid API key from configuration
 * @returns Express middleware function
 */
export function createAuthMiddleware(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
    // If no API key is configured, allow the request
    // This is useful for development environments where auth might be optional
    if (!apiKey) {
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

    try {
      // Use timingSafeEqual to prevent timing attacks
      const bufferProvided = Buffer.from(providedKey);
      const bufferActual = Buffer.from(apiKey);

      if (
        bufferProvided.length === bufferActual.length &&
        crypto.timingSafeEqual(bufferProvided, bufferActual)
      ) {
        return next();
      }
    } catch (err) {
      // Fallback if timingSafeEqual fails (e.g. if buffers have different lengths)
      // though we checked lengths above.
    }

    return error(res, {
      message: "Unauthorized: Invalid API key",
      status: 401,
      code: ErrorCode.UNAUTHORIZED,
    });
  };
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
 * @param apiKey The valid API key from configuration
 * @returns Express middleware function
 */
export function requireApiKey(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction) => {
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

    // Validate API key using constant-time comparison
    try {
      const bufferProvided = Buffer.from(providedKey);
      const bufferActual = Buffer.from(apiKey);

      if (
        bufferProvided.length === bufferActual.length &&
        crypto.timingSafeEqual(bufferProvided, bufferActual)
      ) {
        return next();
      }
    } catch (err) {
      // Fallback if timingSafeEqual fails
    }

    // Invalid API key - return 403 to distinguish from missing auth
    return error(res, {
      message: "Forbidden: Invalid API key",
      status: 403,
      code: ErrorCode.FORBIDDEN,
    });
  };
}
