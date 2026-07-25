/**
 * Tests for MockVaultContract.
 *
 * Verify that the mock contract:
 * 1. Implements all contract methods correctly
 * 2. Maintains proper state
 * 3. Enforces business rules (spending limits, timelocks, etc.)
 * 4. Supports failure injection for error testing
 * 5. Supports ledger/time progression for timelock testing
 */

import { describe, it, expect, beforeEach } from "vitest";
import { MockVaultContract } from "./mock-contract";
import { Role, ProposalStatus, VaultErrorCode, VaultError } from "./types";
import type { InitConfig } from "./types";

describe("MockVaultContract", () => {
  let mock: MockVaultContract;
  let adminKey: string;
  let treasurerKey: string;
  let memberKey: string;
  let config: InitConfig;

  beforeEach(() => {
    mock = new MockVaultContract();
    adminKey = "GAAAA";
    treasurerKey = "GBBBB";
    memberKey = "GCCCC";

    config = {
      signers: [adminKey, treasurerKey],
      threshold: 2,
      spendingLimit: 1000n,
      dailyLimit: 5000n,
      weeklyLimit: 20000n,
      timelockThreshold: 500n,
      timelockDelay: 100n,
    };
  });

  describe("Initialization", () => {
    it("should initialize the vault", () => {
      mock.initialize(adminKey, config);
      const vaultConfig = mock.getConfig();

      expect(vaultConfig.threshold).toBe(2);
      expect(vaultConfig.signers).toContain(adminKey);
      expect(vaultConfig.spendingLimit).toBe(1000n);
    });

    it("should reject double initialization", () => {
      mock.initialize(adminKey, config);

      expect(() => mock.initialize(adminKey, config)).toThrow();
    });

    it("should set admin role on initializer", () => {
      mock.initialize(adminKey, config);
      const role = mock.getRole(adminKey);

      expect(role).toBe(Role.Admin);
    });
  });

  describe("Role Management", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
    });

    it("should set roles for users", () => {
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
      const role = mock.getRole(treasurerKey);

      expect(role).toBe(Role.Treasurer);
    });

    it("should default to Member role", () => {
      const role = mock.getRole(memberKey);

      expect(role).toBe(Role.Member);
    });

    it("should reject non-admin attempts to set roles", () => {
      expect(() => {
        mock.setRole(memberKey, treasurerKey, Role.Treasurer);
      }).toThrow();
    });
  });

  describe("Proposals", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
    });

    it("should create a proposal", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test transfer"
      );

      expect(proposal.id).toBe(1n);
      expect(proposal.proposer).toBe(treasurerKey);
      expect(proposal.amount).toBe(100n);
      expect(proposal.status).toBe(ProposalStatus.Pending);
    });

    it("should reject proposals exceeding spending limit", () => {
      expect(() => {
        mock.proposeTransfer(
          treasurerKey,
          "GRECEIVER",
          "CTOKEN",
          2000n, // Exceeds limit of 1000
          "Too much"
        );
      }).toThrow();
    });

    it("should reject proposals from non-treasurers", () => {
      expect(() => {
        mock.proposeTransfer(
          memberKey,
          "GRECEIVER",
          "CTOKEN",
          100n,
          "Not allowed"
        );
      }).toThrow();
    });

    it("should retrieve proposal by ID", () => {
      const created = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      const retrieved = mock.getProposal(created.id);

      expect(retrieved).toEqual(created);
    });

    it("should throw NotFound for non-existent proposal", () => {
      expect(() => mock.getProposal(999n)).toThrow();
    });
  });

  describe("Approvals and Execution", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
      mock.setRole(adminKey, adminKey, Role.Treasurer); // Admin can also be treasurer
    });

    it("should approve a proposal", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      const approved = mock.approveProposal(adminKey, proposal.id);

      expect(approved.approvals.length).toBe(2); // proposer + approver
      expect(approved.status).toBe(ProposalStatus.Approved); // threshold reached (2/2)
    });

    it("should reject double-approval from same signer", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      expect(() => {
        mock.approveProposal(treasurerKey, proposal.id);
      }).toThrow();
    });

    it("should execute an approved proposal", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      mock.approveProposal(adminKey, proposal.id);
      const executed = mock.executeProposal(adminKey, proposal.id);

      expect(executed.status).toBe(ProposalStatus.Executed);
    });

    it("should reject execution of non-approved proposal", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      expect(() => {
        mock.executeProposal(adminKey, proposal.id);
      }).toThrow();
    });
  });

  describe("Timelocks", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
      mock.setRole(adminKey, adminKey, Role.Treasurer);
    });

    it("should apply timelock to large proposals", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        600n, // Above timelockThreshold of 500n
        "Large transfer"
      );

      expect(proposal.unlockLedger).toBeGreaterThan(0n);
    });

    it("should not apply timelock to small proposals", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n, // Below timelockThreshold of 500n
        "Small transfer"
      );

      expect(proposal.unlockLedger).toBe(0n);
    });

    it("should reject execution before timelock expires", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        600n,
        "Large transfer"
      );

      mock.approveProposal(adminKey, proposal.id);

      expect(() => {
        mock.executeProposal(adminKey, proposal.id);
      }).toThrow();
    });

    it("should allow execution after timelock expires", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        600n,
        "Large transfer"
      );

      mock.approveProposal(adminKey, proposal.id);

      // Advance ledger past unlock time
      mock.advanceLedger(proposal.unlockLedger + 1n);

      const executed = mock.executeProposal(adminKey, proposal.id);

      expect(executed.status).toBe(ProposalStatus.Executed);
    });
  });

  describe("Recurring Payments", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
    });

    it("should create a recurring payment", () => {
      const payment = mock.schedulePayment(
        treasurerKey,
        "GRECIPIENT",
        "CTOKEN",
        100n,
        "Monthly fee",
        1000n
      );

      expect(payment.id).toBe(1n);
      expect(payment.recipient).toBe("GRECIPIENT");
      expect(payment.isActive).toBe(true);
      expect(payment.paymentCount).toBe(0);
    });

    it("should reject intervals below 720 ledgers", () => {
      expect(() => {
        mock.schedulePayment(
          treasurerKey,
          "GRECIPIENT",
          "CTOKEN",
          100n,
          "Invalid",
          500n // Too small
        );
      }).toThrow();
    });

    it("should execute recurring payment when due", () => {
      const payment = mock.schedulePayment(
        treasurerKey,
        "GRECIPIENT",
        "CTOKEN",
        100n,
        "Monthly",
        1000n
      );

      // Advance past next payment time
      mock.advanceLedger(payment.nextPaymentLedger + 1n);

      const executed = mock.executeRecurringPayment(payment.id);

      expect(executed.paymentCount).toBe(1);
      expect(executed.nextPaymentLedger).toBe(payment.nextPaymentLedger + 1000n);
    });

    it("should reject execution before payment is due", () => {
      const payment = mock.schedulePayment(
        treasurerKey,
        "GRECIPIENT",
        "CTOKEN",
        100n,
        "Monthly",
        1000n
      );

      expect(() => {
        mock.executeRecurringPayment(payment.id);
      }).toThrow();
    });
  });

  describe("Failure Injection", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
    });

    it("should trigger injected failures", () => {
      mock.injectFailure("proposeTransfer", VaultErrorCode.Unauthorized, "Simulated failure");

      expect(() => {
        mock.proposeTransfer(
          treasurerKey,
          "GRECIPIENT",
          "CTOKEN",
          100n,
          "Test"
        );
      }).toThrow();
    });

    it("should clear all failures", () => {
      mock.injectFailure("proposeTransfer", VaultErrorCode.Unauthorized);
      mock.clearFailures();

      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECIPIENT",
        "CTOKEN",
        100n,
        "Test"
      );

      expect(proposal).toBeDefined();
    });

    it("should only trigger failure once", () => {
      mock.injectFailure("proposeTransfer", VaultErrorCode.Unauthorized);

      // First call fails
      expect(() => {
        mock.proposeTransfer(treasurerKey, "GRECIPIENT", "CTOKEN", 100n, "Test1");
      }).toThrow();

      // Second call succeeds
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECIPIENT",
        "CTOKEN",
        100n,
        "Test2"
      );

      expect(proposal).toBeDefined();
    });
  });

  describe("Time and Ledger Controls", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
    });

    it("should advance ledger", () => {
      const before = mock.getState().currentLedger;
      mock.advanceLedger(50);
      const after = mock.getState().currentLedger;

      expect(after).toBe(before + 50n);
    });

    it("should advance time", () => {
      const before = mock.getState().currentTime;
      mock.advanceTime(3600000); // 1 hour
      const after = mock.getState().currentTime;

      expect(after).toBe(before + 3600000n);
    });

    it("should set ledger directly", () => {
      mock.setLedger(12345);
      expect(mock.getState().currentLedger).toBe(12345n);
    });

    it("should set time directly", () => {
      mock.setTime(1700000000000);
      expect(mock.getState().currentTime).toBe(1700000000000n);
    });
  });

  describe("State Retrieval", () => {
    it("should report initialization state", () => {
      let state = mock.getState();
      expect(state.isInitialized).toBe(false);

      mock.initialize(adminKey, config);

      state = mock.getState();
      expect(state.isInitialized).toBe(true);
      expect(state.config).toBeDefined();
    });

    it("should count entities in state", () => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);

      mock.proposeTransfer(treasurerKey, "GRECEIVER", "CTOKEN", 100n, "Test1");
      mock.proposeTransfer(treasurerKey, "GRECEIVER", "CTOKEN", 200n, "Test2");

      const state = mock.getState();

      expect(state.proposalCount).toBe(2);
      expect(state.roleCount).toBe(2); // admin + treasurer
    });
  });

  describe("Signer Management", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
    });

    it("should add signers", () => {
      const newSigner = "GNEWSIGNER";
      mock.addSigner(adminKey, newSigner);

      const vaultConfig = mock.getConfig();
      expect(vaultConfig.signers).toContain(newSigner);
    });

    it("should reject non-admin adding signers", () => {
      expect(() => {
        mock.addSigner(memberKey, "GNEWSIGNER");
      }).toThrow();
    });

    it("should reject duplicate signers", () => {
      expect(() => {
        mock.addSigner(adminKey, adminKey);
      }).toThrow();
    });

    it("should remove signers", () => {
      const signerToRemove = config.signers[0];
      mock.removeSigner(adminKey, signerToRemove);

      const vaultConfig = mock.getConfig();
      expect(vaultConfig.signers).not.toContain(signerToRemove);
    });

    it("should reject non-admin removing signers", () => {
      expect(() => {
        mock.removeSigner(memberKey, adminKey);
      }).toThrow();
    });

    it("should reject removing non-existent signer", () => {
      expect(() => {
        mock.removeSigner(adminKey, "GNONEXISTENT");
      }).toThrow();
    });
  });

  describe("Proposal Rejection", () => {
    beforeEach(() => {
      mock.initialize(adminKey, config);
      mock.setRole(adminKey, treasurerKey, Role.Treasurer);
    });

    it("should reject a pending proposal", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      const rejected = mock.rejectProposal(adminKey, proposal.id);

      expect(rejected.status).toBe(ProposalStatus.Rejected);
    });

    it("should reject an approved proposal", () => {
      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      mock.approveProposal(adminKey, proposal.id);
      const rejected = mock.rejectProposal(adminKey, proposal.id);

      expect(rejected.status).toBe(ProposalStatus.Rejected);
    });

    it("should reject rejection of executed proposal", () => {
      mock.setRole(adminKey, adminKey, Role.Treasurer);

      const proposal = mock.proposeTransfer(
        treasurerKey,
        "GRECEIVER",
        "CTOKEN",
        100n,
        "Test"
      );

      mock.approveProposal(adminKey, proposal.id);
      mock.executeProposal(adminKey, proposal.id);

      expect(() => {
        mock.rejectProposal(adminKey, proposal.id);
      }).toThrow();
    });
  });
});
