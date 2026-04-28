import type { AuditEntry, AuditPage } from "./audit.types.js";

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

export class AuditService {
  constructor(
    private readonly rpcUrl: string,
    private readonly fetchFn: typeof fetch = globalThis.fetch,
  ) {}

  async getAuditTrail(
    contractId: string,
    offset: number,
    limit: number,
  ): Promise<AuditPage> {
    let response: Response;
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
    return {
      data: entries,
      total,
      offset,
      limit,
    };
  }

  private buildInvocationXdr(
    contractId: string,
    offset: number,
    limit: number,
  ): string {
    // In production replace with stellar-sdk XDR encoding.
    // Tests mock the entire fetch so this is never sent to a real RPC.
    return Buffer.from(
      JSON.stringify({ fn: "get_audit_trail", contractId, offset, limit }),
    ).toString("base64");
  }
}
