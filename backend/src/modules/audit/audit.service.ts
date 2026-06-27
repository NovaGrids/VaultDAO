import { createHash } from "node:crypto";
import type { Response as ExpressResponse } from "express";
import type {
  AuditEntry,
  AuditPage,
  AuditVerificationResult,
} from "./audit.types.js";
import { AUDIT_ACTION_DISCRIMINANT } from "./audit.types.js";

export class AuditRpcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuditRpcError";
  }
}

interface RpcSimulateResult {
  entries: AuditEntry[];
  total: number;
}

interface RpcResponse {
  error?: { code: number; message: string };
  result?: RpcSimulateResult;
}

/**
 * Recomputes SHA-256(id || action || actor || target || timestamp || prev_hash)
 * matching the on-chain compute_audit_hash algorithm exactly.
 *
 * On-chain layout (68 bytes, all little-endian):
 *   id:        u64  (8 bytes LE)
 *   action:    u32  (4 bytes LE)
 *   actor:     [u8; 32] (raw Stellar address bytes — we use the hex string as UTF-8 bytes)
 *   target:    u64  (8 bytes LE)
 *   timestamp: u64  (8 bytes LE)
 *   prev_hash: u64  (8 bytes LE)
 *
 * Returns the first 8 bytes of SHA-256 interpreted as u64 LE, as a hex string.
 */
function computeAuditHash(entry: AuditEntry): string {
  const buf = Buffer.alloc(68);
  let offset = 0;

  // id: u64 LE
  buf.writeBigUInt64LE(BigInt(entry.id), offset);
  offset += 8;

  // action: u32 LE (discriminant)
  const actionDiscriminant = AUDIT_ACTION_DISCRIMINANT[entry.action] ?? 0;
  buf.writeUInt32LE(actionDiscriminant, offset);
  offset += 4;

  // actor: 32 bytes (pad/truncate UTF-8 bytes of the actor string)
  const actorBytes = Buffer.from(entry.actor, "utf8");
  actorBytes.copy(buf, offset, 0, Math.min(actorBytes.length, 32));
  offset += 32;

  // target: u64 LE
  buf.writeBigUInt64LE(BigInt(entry.target), offset);
  offset += 8;

  // timestamp: u64 LE
  buf.writeBigUInt64LE(BigInt(entry.timestamp), offset);
  offset += 8;

  // prev_hash: u64 LE
  buf.writeBigUInt64LE(BigInt(entry.prev_hash), offset);

  const sha = createHash("sha256").update(buf).digest();
  // First 8 bytes as u64 LE
  return sha.readBigUInt64LE(0).toString();
}

export function verifyAuditChain(
  entries: AuditEntry[],
): AuditVerificationResult {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const computed = computeAuditHash(entry);
    if (computed !== entry.hash) {
      return { verified: false, brokenAtEntry: i };
    }
    if (i > 0) {
      const prev = entries[i - 1]!;
      if (entry.prev_hash !== prev.hash) {
        return { verified: false, brokenAtEntry: i };
      }
    }
  }
  return { verified: true, brokenAtEntry: null };
}

/**
 * Streams audit entries as CSV to the response.
 * Avoids buffering all rows in memory.
 */
export function streamAuditCsv(
  res: ExpressResponse,
  entries: AuditEntry[],
  verificationResult?: AuditVerificationResult,
): void {
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="audit-log.csv"');

  res.write("id,action,actor,target,timestamp,hash,verified\n");

  const verifiedMap = new Map<string, boolean>();
  if (verificationResult) {
    const brokenAt = verificationResult.brokenAtEntry;
    entries.forEach((e, idx) => {
      verifiedMap.set(e.id, brokenAt === null || idx < brokenAt);
    });
  }

  for (const entry of entries) {
    const verified =
      verificationResult !== undefined
        ? (verifiedMap.get(entry.id) ?? false)
        : "";
    const row = [
      entry.id,
      entry.action,
      `"${entry.actor}"`,
      entry.target,
      `"${entry.timestamp}"`,
      entry.hash,
      verified,
    ].join(",");
    res.write(row + "\n");
  }

  res.end();
}

export class AuditService {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async getAuditTrail(
    contractId: string,
    offset: number,
    limit: number,
    verify = false,
  ): Promise<AuditPage> {
    let response: globalThis.Response;
    try {
      response = await this.fetchFn(this.rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "simulateTransaction",
          params: {
            transaction: this.buildInvocationXdr(contractId, offset, limit),
          },
        }),
      });
    } catch (err) {
      throw new AuditRpcError(
        `RPC request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      throw new AuditRpcError(
        `RPC returned HTTP ${response.status}: ${response.statusText}`,
      );
    }

    const json = (await response.json()) as RpcResponse;

    if (json.error) {
      throw new AuditRpcError(
        `RPC error ${json.error.code}: ${json.error.message}`,
      );
    }

    if (!json.result) {
      throw new AuditRpcError("RPC returned empty result");
    }

    const { entries, total } = json.result;

    const page: AuditPage = { data: entries, total, offset, limit };

    if (verify) {
      page.verification = verifyAuditChain(entries);
    }

    return page;
  }

  private buildInvocationXdr(
    contractId: string,
    offset: number,
    limit: number,
  ): string {
    return Buffer.from(
      JSON.stringify({ fn: "get_audit_trail", contractId, offset, limit }),
    ).toString("base64");
  }
}
