import { describe, it, expect } from "vitest";
import {
  extractStateDiff,
  simulate_with_state_diff,
  simulateWithStateDiff,
  MockVaultContract,
} from "./index";

describe("SDK Transaction Simulation with State Diffing (#1456)", () => {
  it("should extract state diff from raw stateChanges array", () => {
    const rawSimResult = {
      stateChanges: [
        {
          key: "proposal_101",
          before: { status: "Pending" },
          after: { status: "Approved" },
        },
        {
          key: "signer_G_NEW_USER",
          before: null,
          after: { role: "Member", isActive: true },
        },
      ],
    };

    const diff = extractStateDiff(rawSimResult);

    expect(diff.modifiedKeys).toHaveProperty("proposal_101");
    expect(diff.modifiedKeys["proposal_101"]).toEqual({
      before: { status: "Pending" },
      after: { status: "Approved" },
    });

    expect(diff.newKeys).toContain("signer_G_NEW_USER");
    expect(diff.changes).toHaveLength(2);
    expect(diff.changes[1].isNew).toBe(true);
  });

  it("should support simulate_with_state_diff helper function", async () => {
    const simData = {
      state_changes: [
        {
          key: "vault_balance",
          before: 1000000n,
          after: 900000n,
        },
        {
          key: "escrow_99",
          before: undefined,
          after: { amount: 100000n },
        },
      ],
    };

    const diff = await simulate_with_state_diff(simData);

    expect(diff.modifiedKeys["vault_balance"]).toEqual({
      before: 1000000n,
      after: 900000n,
    });
    expect(diff.newKeys).toEqual(["escrow_99"]);
    expect(diff.changes[1].key).toBe("escrow_99");
    expect(diff.changes[1].isNew).toBe(true);
  });

  it("should support MockVaultContract simulate_with_state_diff", () => {
    const mock = new MockVaultContract();
    mock.initialize("G_ADMIN", {
      signers: ["G_ADMIN", "G_USER2"],
      threshold: 2,
      spendingLimit: 10000n,
      dailyLimit: 50000n,
      weeklyLimit: 200000n,
      timelockThreshold: 5000n,
      timelockDelay: 100n,
    });

    const diff = mock.simulate_with_state_diff({
      proposal_1: {
        before: { status: 0 },
        after: { status: 1 },
      },
      proposal_2: {
        before: null,
        after: { id: 2n, status: 0 },
      },
    });

    expect(diff.modifiedKeys["proposal_1"]).toEqual({
      before: { status: 0 },
      after: { status: 1 },
    });
    expect(diff.newKeys).toContain("proposal_2");
    expect(diff.changes.find((c) => c.key === "proposal_2")?.isNew).toBe(true);
  });
});
