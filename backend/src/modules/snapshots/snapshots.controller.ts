import type { RequestHandler } from "express";
import type { SnapshotService } from "./snapshot.service.js";
import { success, error } from "../../shared/http/response.js";
import { validateOptionalBoolean } from "../../shared/http/validateQuery.js";
import type { SerializableContractSnapshot } from "./types.js";
import type { CacheAdapter } from "../../shared/cache/cache.adapter.js";
import { createLogger } from "../../shared/logging/logger.js";

const logger = createLogger("snapshots-controller");

/** TTL for snapshot cache: 60 seconds */
const SNAPSHOT_CACHE_TTL_MS = 60_000;

export function createSnapshotControllers(
  service: SnapshotService,
  cache?: CacheAdapter<unknown>,
) {
  const getSnapshot: RequestHandler = async (req, res) => {
    try {
      const contractId = req.params.contractId as string;
      const cacheKey = `snapshot:${contractId}`;

      if (cache) {
        const cached = cache.get(cacheKey);
        if (cached !== null) {
          res.json(cached);
          return;
        }
      }

      const snapshot = await service.getSnapshot(contractId);
      if (!snapshot)
        return error(res, { message: "Snapshot not found", status: 404 });

      const serializable: SerializableContractSnapshot = {
        ...snapshot,
        signers: Object.fromEntries(snapshot.signers),
        roles: Object.fromEntries(snapshot.roles),
      };

      if (cache) {
        cache.set(
          cacheKey,
          { ok: true, data: serializable },
          SNAPSHOT_CACHE_TTL_MS,
        );
      }

      success(res, serializable);
    } catch (err) {
      logger.error("getSnapshot error", { error: String(err) });
      error(res, { message: "Storage error", status: 503 });
    }
  };

  const getSigners: RequestHandler = async (req, res) => {
    try {
      const contractId = req.params.contractId as string;
      const isActive = validateOptionalBoolean(req, res, "active");
      if (isActive === null) return;

      const signers = await service.getSigners(contractId, { isActive });
      success(res, signers);
    } catch (err) {
      logger.error("getSigners error", { error: String(err) });
      error(res, { message: "Storage error", status: 503 });
    }
  };

  const getSigner: RequestHandler = async (req, res) => {
    try {
      const contractId = req.params.contractId as string;
      const address = req.params.address as string;
      const signer = await service.getSigner(contractId, address);
      if (!signer) {
        return error(res, { message: "Signer not found", status: 404 });
      }
      success(res, signer);
    } catch (err) {
      logger.error("getSigner error", { error: String(err) });
      error(res, { message: "Storage error", status: 503 });
    }
  };

  const getRoles: RequestHandler = async (req, res) => {
    try {
      const roles = await service.getRoles(req.params.contractId as string);
      success(res, roles);
    } catch (err) {
      logger.error("getRoles error", { error: String(err) });
      error(res, { message: "Storage error", status: 503 });
    }
  };

  const getStats: RequestHandler = async (req, res) => {
    try {
      const stats = await service.getStats(req.params.contractId as string);
      if (!stats)
        return error(res, { message: "Snapshot not found", status: 404 });
      success(res, stats);
    } catch (err) {
      logger.error("getStats error", { error: String(err) });
      error(res, { message: "Storage error", status: 503 });
    }
  };

  const rebuildSnapshot: RequestHandler = async (req, res) => {
    try {
      const contractId = req.params.contractId as string;
      const { startLedger = 0, endLedger } = req.body;

      if (
        startLedger < 0 ||
        (endLedger !== undefined && endLedger < startLedger)
      ) {
        return error(res, { message: "Invalid ledger range", status: 400 });
      }

      let finalEndLedger = endLedger;
      if (finalEndLedger === undefined) {
        const stats = await service.getStats(contractId);
        finalEndLedger = stats?.lastProcessedLedger ?? startLedger + 1000;
      }

      const range = finalEndLedger - startLedger;
      const ASYNC_THRESHOLD = 10000;

      if (range > ASYNC_THRESHOLD) {
        service
          .rebuildFromRpc(contractId, startLedger, finalEndLedger)
          .catch((rebuildErr) =>
            logger.error("Async rebuild failed", { error: String(rebuildErr) }),
          );
        // Invalidate cache after rebuild is triggered
        if (cache) cache.deleteByPrefix(`snapshot:${contractId}`);
        return success(
          res,
          {
            message: "Rebuild started asynchronously for large range",
            range: { startLedger, endLedger: finalEndLedger },
          },
          { status: 202 },
        );
      }

      const result = await service.rebuildFromRpc(
        contractId,
        startLedger,
        finalEndLedger,
      );

      if (!result.success) {
        return error(res, {
          message: result.error || "Rebuild failed",
          status: 500,
          details: result,
        });
      }

      // Invalidate snapshot cache after successful rebuild
      if (cache) cache.deleteByPrefix(`snapshot:${contractId}`);

      success(res, {
        message: "Rebuild completed successfully",
        summary: {
          eventsProcessed: result.eventsProcessed,
          signersUpdated: result.signersUpdated,
          rolesUpdated: result.rolesUpdated,
          lastProcessedLedger: result.lastProcessedLedger,
        },
      });
    } catch (err) {
      logger.error("rebuildSnapshot error", { error: String(err) });
      error(res, { message: "Storage error", status: 503 });
    }
  };

  const verifyConsistency: RequestHandler = async (req, res) => {
    try {
      const contractId = req.params.contractId as string;
      const result = await service.verifySnapshotConsistency(contractId);
      // 200 regardless of outcome: the verification itself succeeded. Callers
      // read `consistent` (and `mismatches`) to decide how to react.
      success(res, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/no snapshot found/i.test(message)) {
        return error(res, { message: "Snapshot not found", status: 404 });
      }
      if (/on-chain config provider/i.test(message)) {
        return error(res, {
          message: "Consistency verification is not configured",
          status: 501,
        });
      }
      logger.error("verifyConsistency error", { error: String(err) });
      error(res, { message: "Verification failed", status: 502 });
    }
  };

  return {
    getSnapshot,
    getSigners,
    getSigner,
    getRoles,
    getStats,
    rebuildSnapshot,
    verifyConsistency,
  };
}

/**
 * Invalidates snapshot cache for a given contractId.
 * Call this when new snapshot events are processed.
 */
export function invalidateSnapshotCache(
  cache: CacheAdapter<unknown>,
  contractId: string,
): void {
  cache.deleteByPrefix(`snapshot:${contractId}`);
}
