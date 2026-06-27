import type { RequestHandler } from "express";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";
import type { VaultService } from "./vault.service.js";
import type { CacheManager } from "../../shared/cache/cache-manager.js";

const STELLAR_ID_RE = /^C[A-Z0-9]{55}$/;
const CACHE_TTL_MS = 60_000; // 60 seconds caching

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

export function createVaultConfigController(
  service: VaultService,
  cache?: CacheManager,
): RequestHandler {
  return async (request, response) => {
    const contractId = getSingleQueryString(
      request.query as Record<string, unknown>,
      "contractId",
    );

    if (!contractId) {
      error(response, {
        message: "contractId is required",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    if (!STELLAR_ID_RE.test(contractId)) {
      error(response, {
        message: "Invalid contractId format",
        status: 400,
        code: ErrorCode.VALIDATION_ERROR,
      });
      return;
    }

    const cacheKey = `vault-config:${contractId}`;

    try {
      // Use standard CacheManager getOrSet facade with fallback support
      const config = cache
        ? await cache.getOrSet(cacheKey, CACHE_TTL_MS, () =>
            service.getVaultConfig(contractId),
          )
        : await service.getVaultConfig(contractId);

      success(response, config);
    } catch (err) {
      const reqId = request.headers["x-request-id"] ?? (request as any).requestId;
      console.error(
        `[vault-controller] Failed to fetch vault config for ${contractId} (reqId=${reqId}):`,
        err,
      );

      error(response, {
        message: err instanceof Error ? err.message : "Failed to simulate transaction on RPC",
        status: 502,
        code: ErrorCode.INTERNAL_ERROR,
      });
    }
  };
}
