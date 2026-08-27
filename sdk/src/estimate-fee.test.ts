import { describe, expect, it, vi } from "vitest";
import { SorobanRpc } from "stellar-sdk";
import { estimateFee } from "./utils";
import type { SdkOptions } from "./types";

const opts: SdkOptions = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
};

describe("estimateFee", () => {
  it("returns the minimum Soroban inclusion fee in stroops", async () => {
    const simulateTransaction = vi
      .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({
        minResourceFee: "12345",
      } as any);

    await expect(estimateFee(opts, "approve_proposal", [1n])).resolves.toBe(12445);

    expect(simulateTransaction).toHaveBeenCalledOnce();
    simulateTransaction.mockRestore();
  });

  it("rejects an invalid fee returned by RPC", async () => {
    const simulateTransaction = vi
      .spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
      .mockResolvedValue({
        minResourceFee: "not-a-fee",
      } as any);

    await expect(estimateFee(opts, "approve_proposal", [])).rejects.toThrow(
      "invalid Soroban inclusion fee"
    );

    simulateTransaction.mockRestore();
  });
});