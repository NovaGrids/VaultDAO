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
