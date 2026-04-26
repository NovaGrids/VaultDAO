import assert from "node:assert/strict";
import { test, describe } from "node:test";

import type { ContractEvent } from "../events.types.js";
import { EventNormalizer } from "./index.js";
import { EventType } from "../types.js";

describe("EventNormalizer", () => {
  const mockMetadata = {
    contractId: "CD123",
    id: "evt-001",
    ledger: 100,
    ledgerClosedAt: "2026-03-25T14:00:00Z",
  };

  test("should normalize proposal_created event", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["proposal_created", "42"],
        value: ["proposer-addr", "recipient-addr", "token-addr", "1000", "50"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.PROPOSAL_CREATED);
    assert.strictEqual(normalized.data.proposalId, "42");
    assert.strictEqual(normalized.data.proposer, "proposer-addr");
    assert.strictEqual(normalized.data.amount, "1000");
    assert.strictEqual(normalized.data.insuranceAmount, "50");
    assert.strictEqual(normalized.metadata.ledger, 100);
  });

  test("should normalize proposal_executed event", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["proposal_executed", "42"],
        value: ["executor-addr", "recipient-addr", "token-addr", "1000", "101"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.PROPOSAL_EXECUTED);
    assert.strictEqual(normalized.data.proposalId, "42");
    assert.strictEqual(normalized.data.executor, "executor-addr");
    assert.strictEqual(normalized.data.ledger, 101);
  });

  test("should handle unknown event topics safely", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["mystery_event"],
        value: ["some-data"],
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
    assert.strictEqual(normalized.data.reason, "Unmapped topic");
    assert.strictEqual(normalized.data.rawTopic[0], "mystery_event");
  });

  test("should handle malformed event data gracefully", () => {
    const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["proposal_created", "42"],
        value: null, // Malformed: value should be array
    };

    const normalized = EventNormalizer.normalize(rawEvent);

    assert.strictEqual(normalized.type, EventType.UNKNOWN);
    assert.ok(normalized.data.reason.includes("Normalization error"));
  });

  describe("Insurance events", () => {
    test("should normalize insurance_locked event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["insurance_locked", "prop-1"],
        value: ["proposer-addr", "500", "USDC"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.INSURANCE_LOCKED);
      assert.strictEqual(normalized.data.proposalId, "prop-1");
      assert.strictEqual(normalized.data.proposer, "proposer-addr");
      assert.strictEqual(normalized.data.amount, "500");
      assert.strictEqual(normalized.data.token, "USDC");
    });

    test("should normalize insurance_slashed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["insurance_slashed", "prop-2"],
        value: ["proposer-addr", "400", "100"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.INSURANCE_SLASHED);
      assert.strictEqual(normalized.data.proposalId, "prop-2");
      assert.strictEqual(normalized.data.slashedAmount, "400");
      assert.strictEqual(normalized.data.returnedAmount, "100");
    });

    test("should normalize insurance_returned event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["insurance_returned", "prop-3"],
        value: ["proposer-addr", "500"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.INSURANCE_RETURNED);
      assert.strictEqual(normalized.data.amount, "500");
    });
  });

  describe("Staking events", () => {
    test("should normalize stake_locked event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["stake_locked", "prop-4"],
        value: ["staker-addr", "1000", "XLM"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.STAKE_LOCKED);
      assert.strictEqual(normalized.data.proposalId, "prop-4");
      assert.strictEqual(normalized.data.staker, "staker-addr");
      assert.strictEqual(normalized.data.amount, "1000");
      assert.strictEqual(normalized.data.token, "XLM");
    });

    test("should normalize stake_slashed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["stake_slashed", "prop-5"],
        value: ["staker-addr", "800", "200"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.STAKE_SLASHED);
      assert.strictEqual(normalized.data.slashedAmount, "800");
      assert.strictEqual(normalized.data.returnedAmount, "200");
    });

    test("should normalize stake_refunded event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["stake_refunded", "prop-6"],
        value: ["staker-addr", "1000"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.STAKE_REFUNDED);
      assert.strictEqual(normalized.data.staker, "staker-addr");
      assert.strictEqual(normalized.data.amount, "1000");
    });
  });

  describe("Recovery events", () => {
    test("should normalize recovery_proposed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["recovery_proposed"],
        value: ["new-owner-addr", "proposer-addr", "rec-prop-1"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.RECOVERY_PROPOSED);
      assert.strictEqual(normalized.data.newOwner, "new-owner-addr");
      assert.strictEqual(normalized.data.proposer, "proposer-addr");
      assert.strictEqual(normalized.data.proposalId, "rec-prop-1");
    });

    test("should normalize recovery_approved event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["recovery_approved"],
        value: ["new-owner-addr", "approver-addr", 2],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.RECOVERY_APPROVED);
      assert.strictEqual(normalized.data.approvalCount, 2);
    });

    test("should normalize recovery_executed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["recovery_executed"],
        value: ["old-owner-addr", "new-owner-addr", "executor-addr"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.RECOVERY_EXECUTED);
      assert.strictEqual(normalized.data.oldOwner, "old-owner-addr");
      assert.strictEqual(normalized.data.newOwner, "new-owner-addr");
    });

    test("should normalize recovery_cancelled event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["recovery_cancelled"],
        value: ["new-owner-addr", "canceller-addr"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.RECOVERY_CANCELLED);
      assert.strictEqual(normalized.data.cancelledBy, "canceller-addr");
    });
  });

  describe("Subscription and streaming events", () => {
    test("should normalize stream_status event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["stream_status", "stream-1"],
        value: ["active", "owner-addr"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.STREAM_STATUS);
      assert.strictEqual(normalized.data.streamId, "stream-1");
      assert.strictEqual(normalized.data.status, "active");
    });

    test("should normalize stream_claimed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["stream_claimed", "stream-2"],
        value: ["recipient-addr", "250"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.STREAM_CLAIMED);
      assert.strictEqual(normalized.data.recipient, "recipient-addr");
      assert.strictEqual(normalized.data.amount, "250");
    });

    test("should normalize subscription_created event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["subscription_created", "sub-1"],
        value: ["subscriber-addr", "service-addr", "100", "USDC", 720],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.SUBSCRIPTION_CREATED);
      assert.strictEqual(normalized.data.subscriptionId, "sub-1");
      assert.strictEqual(normalized.data.subscriber, "subscriber-addr");
      assert.strictEqual(normalized.data.intervalLedgers, 720);
    });

    test("should normalize subscription_cancelled event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["subscription_cancelled", "sub-2"],
        value: ["canceller-addr"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.SUBSCRIPTION_CANCELLED);
      assert.strictEqual(normalized.data.cancelledBy, "canceller-addr");
    });

    test("should normalize subscription_expired event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["subscription_expired", "sub-3"],
        value: ["subscriber-addr"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.SUBSCRIPTION_EXPIRED);
      assert.strictEqual(normalized.data.subscriber, "subscriber-addr");
    });
  });

  describe("Misc events", () => {
    test("should normalize reputation_updated event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["reputation_updated"],
        value: ["user-addr", 50, 75, "good-proposal"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.REPUTATION_UPDATED);
      assert.strictEqual(normalized.data.address, "user-addr");
      assert.strictEqual(normalized.data.oldScore, 50);
      assert.strictEqual(normalized.data.newScore, 75);
      assert.strictEqual(normalized.data.reason, "good-proposal");
    });

    test("should normalize batch_executed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["batch_executed", "batch-1"],
        value: ["executor-addr", 5, 5],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.BATCH_EXECUTED);
      assert.strictEqual(normalized.data.batchId, "batch-1");
      assert.strictEqual(normalized.data.count, 5);
      assert.strictEqual(normalized.data.successCount, 5);
    });

    test("should normalize tokens_locked event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["tokens_locked"],
        value: ["user-addr", "1000", "XLM", 5000],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.TOKENS_LOCKED);
      assert.strictEqual(normalized.data.address, "user-addr");
      assert.strictEqual(normalized.data.amount, "1000");
      assert.strictEqual(normalized.data.unlockLedger, 5000);
    });

    test("should normalize cv_proposed (cross-vault) event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["cv_proposed", "cv-prop-1"],
        value: ["source-vault", "target-vault", "500", "USDC"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.CROSS_VAULT_PROPOSED);
      assert.strictEqual(normalized.data.proposalId, "cv-prop-1");
      assert.strictEqual(normalized.data.sourceVault, "source-vault");
      assert.strictEqual(normalized.data.targetVault, "target-vault");
    });

    test("should normalize config_updated event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["config_updated"],
        value: ["admin-addr", "quorum", "3", "5"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.CONFIG_UPDATED);
      assert.strictEqual(normalized.data.admin, "admin-addr");
      assert.strictEqual(normalized.data.field, "quorum");
      assert.strictEqual(normalized.data.oldValue, "3");
      assert.strictEqual(normalized.data.newValue, "5");
    });
  });

  describe("Funding round extension events", () => {
    test("should normalize funding_round_approved event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["funding_round_approved", "round-1"],
        value: ["prop-1", "approver-addr"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.FUNDING_ROUND_APPROVED);
      assert.strictEqual(normalized.data.roundId, "round-1");
      assert.strictEqual(normalized.data.proposalId, "prop-1");
    });

    test("should normalize funding_round_completed event", () => {
      const rawEvent: ContractEvent = {
        ...mockMetadata,
        topic: ["funding_round_completed", "round-2"],
        value: ["recipient-addr", "10000"],
      };

      const normalized = EventNormalizer.normalize(rawEvent);

      assert.strictEqual(normalized.type, EventType.FUNDING_ROUND_COMPLETED);
      assert.strictEqual(normalized.data.recipient, "recipient-addr");
      assert.strictEqual(normalized.data.totalReleased, "10000");
    });
  });
});
