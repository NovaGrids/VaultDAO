import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { VaultService } from "./vault.service.js";
import { createVaultConfigController } from "./vault.controller.js";
import type { CacheManager } from "../../shared/cache/cache-manager.js";
import type { VaultRegistry } from "./vault-registry.service.js";
import { success, error } from "../../shared/http/response.js";
import { ErrorCode } from "../../shared/http/errorCodes.js";

const STELLAR_CONTRACT_RE = /^C[A-Z0-9]{55}$/;

export function createVaultRouter(
  rpcUrl: string,
  networkPassphrase: string,
  cache?: CacheManager,
  registry?: VaultRegistry,
  adminAuthMiddleware?: (req: Request, res: Response, next: NextFunction) => void,
): Router {
  const router = Router();
  const service = new VaultService(rpcUrl, networkPassphrase);

  router.get("/config", createVaultConfigController(service, cache));

  if (registry) {
    /**
     * GET /api/v1/vaults
     * List monitored vaults with sync status.
     */
    router.get("/", (_req, res) => {
      success(res, registry.list());
    });

    const authGuard = adminAuthMiddleware ?? ((_req, _res, next) => next());

    /**
     * POST /api/v1/vaults
     * Add a vault to monitoring.
     */
    router.post("/", authGuard, (req, res) => {
      const address = String(req.body?.address ?? "").trim();
      if (!address || !STELLAR_CONTRACT_RE.test(address)) {
        error(res, {
          message: "Invalid or missing vault address",
          status: 400,
          code: ErrorCode.VALIDATION_ERROR,
        });
        return;
      }

      const result = registry.addVault(address);
      if (!result.success) {
        error(res, { message: result.error ?? "Failed to add vault", status: 409, code: ErrorCode.BAD_REQUEST });
        return;
      }
      success(res, registry.get(address), { status: 201 });
    });

    /**
     * DELETE /api/v1/vaults/:address
     * Remove a vault from monitoring.
     */
    router.delete("/:address", authGuard, (req, res) => {
      const address = String(req.params["address"] ?? "");
      if (!registry.get(address)) {
        error(res, { message: `Vault ${address} not found`, status: 404, code: ErrorCode.NOT_FOUND });
        return;
      }
      registry.removeVault(address);
      success(res, { removed: true, address });
    });
  }

  return router;
}
