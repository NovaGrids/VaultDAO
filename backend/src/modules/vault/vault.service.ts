import { Account, Address, Operation, TransactionBuilder, scValToNative, xdr } from "stellar-sdk";
import type { VaultConfigResponse } from "./vault.types.js";

export class VaultService {
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly rpcUrl: string,
    private readonly networkPassphrase: string,
    fetchFn: typeof fetch = globalThis.fetch,
  ) {
    this.fetchFn = fetchFn;
  }

  /**
   * Reads and normalizes the vault configuration from the smart contract via RPC simulation.
   *
   * @param contractId - The target vault contract ID (Strkey Cxxx...)
   * @returns The normalized VaultConfigResponse object
   */
  async getVaultConfig(contractId: string): Promise<VaultConfigResponse> {
    // 1. Build host invocation transaction using a dummy source account offline
    const dummyAccount = new Account("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "0");
    const tx = new TransactionBuilder(dummyAccount, { fee: "100" })
      .setNetworkPassphrase(this.networkPassphrase)
      .setTimeout(30)
      .addOperation(
        Operation.invokeHostFunction({
          func: xdr.HostFunction.hostFunctionTypeInvokeContract(
            new xdr.InvokeContractArgs({
              contractAddress: Address.fromString(contractId).toScAddress(),
              functionName: "get_config",
              args: [],
            })
          ),
          auth: [],
        })
      )
      .build();

    const txXdr = tx.toXDR();

    // 2. Query simulateTransaction from Soroban RPC
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
            transaction: txXdr,
          },
        }),
      });
    } catch (err) {
      throw new Error(`RPC simulation request failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (!response.ok) {
      throw new Error(`RPC returned HTTP ${response.status}: ${response.statusText}`);
    }

    const json = (await response.json()) as any;
    if (json.error) {
      throw new Error(`RPC error ${json.error.code}: ${json.error.message}`);
    }

    if (json.result?.error) {
      throw new Error(`RPC simulation failed: ${json.result.error}`);
    }

    const retval = json.result?.result?.retval;
    if (!retval) {
      throw new Error("RPC simulation returned empty return value");
    }

    // 3. Decode the returned ScVal
    const scVal = typeof retval === "string"
      ? xdr.ScVal.fromXDR(retval, "base64")
      : (retval as xdr.ScVal);

    const decoded = scValToNative(scVal);
    if (!decoded || typeof decoded !== "object") {
      throw new Error("Failed to parse contract configuration: invalid shape");
    }

    const cfg = decoded as Record<string, any>;

    // 4. Map and normalize properties with robust fallback support (snake_case/camelCase)
    const signers = Array.isArray(cfg.signers)
      ? cfg.signers.map((s: any) => s.toString())
      : [];

    return {
      signers,
      threshold: Number(cfg.threshold ?? 0),
      spendingLimit: String(cfg.spending_limit ?? cfg.spendingLimit ?? "0"),
      dailyLimit: String(cfg.daily_limit ?? cfg.dailyLimit ?? "0"),
      weeklyLimit: String(cfg.weekly_limit ?? cfg.weeklyLimit ?? "0"),
      timelockThreshold: String(cfg.timelock_threshold ?? cfg.timelockThreshold ?? "0"),
      timelockDelay: String(cfg.timelock_delay ?? cfg.timelockDelay ?? "0"),
    };
  }
}
