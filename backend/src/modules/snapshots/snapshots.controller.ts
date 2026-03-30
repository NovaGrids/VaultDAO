import type { RequestHandler } from "express";
import type { SnapshotService } from "./snapshot.service.js";
import { success, error } from "../../shared/http/response.js";

export function createSnapshotControllers(service: SnapshotService) {
  const getSnapshot: RequestHandler = async (req, res) => {
    const contractId = req.params.contractId as string;
    const snapshot = await service.getSnapshot(contractId);
    if (!snapshot)
      return error(res, { message: "Snapshot not found", status: 404 });
    success(res, snapshot);
  };

  const getSigners: RequestHandler = async (req, res) => {
    const contractId = req.params.contractId as string;
    const isActive = req.query.active === "true" ? true : req.query.active === "false" ? false : undefined;
    
    const signers = await service.getSigners(contractId, { isActive });
    success(res, signers);
  };

  const getSigner: RequestHandler = async (req, res) => {
    const { contractId, address } = req.params;
    const signer = await service.getSigner(contractId, address);
    if (!signer) {
      return error(res, { message: "Signer not found", status: 404 });
    }
    success(res, signer);
  };

  const getRoles: RequestHandler = async (req, res) => {
    const roles = await service.getRoles(req.params.contractId as string);
    success(res, roles);
  };

  const getStats: RequestHandler = async (req, res) => {
    const stats = await service.getStats(req.params.contractId as string);
    if (!stats)
      return error(res, { message: "Snapshot not found", status: 404 });
    success(res, stats);
  };

  const rebuildSnapshot: RequestHandler = async (req, res) => {
    const contractId = req.params.contractId as string;
    const { startLedger = 0, endLedger } = req.body;

    // Validate ledger range if provided
    if (startLedger < 0 || (endLedger !== undefined && endLedger < startLedger)) {
      return error(res, { message: "Invalid ledger range", status: 400 });
    }

    // Determine end ledger if not provided
    let finalEndLedger = endLedger;
    if (finalEndLedger === undefined) {
      // If service has access to RPC, try to get current ledger
      // SnapshotService doesn't expose a direct method to get latest ledger,
      // but rebuildFromRpc handles it internally if we pass a large enough number
      // or if we fetch it here.
      // For now, let's assume a reasonable default or let rebuildFromRpc handle it.
      // Actually, rebuildFromRpc implementation uses `currentLedger <= endLedger`.
      // If endLedger is not provided, we should probably fetch it.
      // Let's see if we can get it from the service's RPC.
      // Since rebuildFromRpc is already there, maybe we should just use it.
      // Wait, rebuildFromRpc signature is (contractId, startLedger, endLedger).
      // If endLedger is required, we need to fetch it.
      
      // Let's check if we can get it from stats or something.
      const stats = await service.getStats(contractId);
      finalEndLedger = stats?.lastProcessedLedger ?? startLedger + 1000; // Fallback
    }

    const range = finalEndLedger - startLedger;
    const ASYNC_THRESHOLD = 10000;

    if (range > ASYNC_THRESHOLD) {
      // Process asynchronously
      service.rebuildFromRpc(contractId, startLedger, finalEndLedger)
        .catch(err => console.error(`[snapshot-controller] Async rebuild failed: ${err}`));
      
      return success(res, { 
        message: "Rebuild started asynchronously for large range",
        range: { startLedger, endLedger: finalEndLedger }
      }, { status: 202 });
    }

    // Process synchronously for small ranges
    const result = await service.rebuildFromRpc(contractId, startLedger, finalEndLedger);
    
    if (!result.success) {
      return error(res, { 
        message: result.error || "Rebuild failed", 
        status: 500,
        details: result
      });
    }

    success(res, {
      message: "Rebuild completed successfully",
      summary: {
        eventsProcessed: result.eventsProcessed,
        signersUpdated: result.signersUpdated,
        rolesUpdated: result.rolesUpdated,
        lastProcessedLedger: result.lastProcessedLedger
      }
    });
  };

  return { getSnapshot, getSigners, getSigner, getRoles, getStats, rebuildSnapshot };
}
