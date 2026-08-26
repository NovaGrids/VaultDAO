/**
 * Tests for SDK input validation layer.
 *
 * Verifies that:
 * 1. Each validator throws SdkValidationError for invalid inputs
 * 2. Each validator accepts valid inputs
 * 3. Contract functions throw SdkValidationError before XDR serialization
 */

import { describe, it, expect } from "vitest";
import {
  SdkValidationError,
  validateNonEmptyString,
  validatePositiveBigInt,
  validateNonNegativeBigInt,
  validatePositiveNumber,
  validateNonNegativeNumber,
  validateThreshold,
  validateMinInterval,
  validateMemo,
  validateRole,
  validateId,
  validateStreamLedgers,
  validateInitConfig,
} from "./validation";
import {
  initialize,
  proposeTransfer,
  approveProposal,
  executeProposal,
  rejectProposal,
  setRole,
  addSigner,
  removeSigner,
  updateLimits,
  updateThreshold,
  schedulePayment,
  executeRecurringPayment,
  createStream,
  claimStream,
  pauseStream,
  cancelStream,
  createSubscription,
  renewSubscription,
  cancelSubscription,
  createEscrow,
  completeMilestone,
  releaseEscrow,
  disputeEscrow,
  createTemplate,
  proposeFromTemplate,
  deactivateTemplate,
  addComment,
  editComment,
  getComments,
  proposeRecovery,
  approveRecovery,
  executeRecovery,
  getVaultMetrics,
  getReputation,
  getAuditTrail,
  getDelegationChain,
  getProposal,
  getRole,
  getTodaySpent,
  isSigner,
} from "./contract";
import { Role } from "./types";

describe("SdkValidationError", () => {
  it("should have the correct name and properties", () => {
    const err = new SdkValidationError("amount", -1n, "amount must be positive");

    expect(err.name).toBe("SdkValidationError");
    expect(err.field).toBe("amount");
    expect(err.value).toBe(-1n);
    expect(err.message).toBe("amount must be positive");
  });
});

describe("validateNonEmptyString", () => {
  it("should pass for non-empty strings", () => {
    expect(() => validateNonEmptyString("address", "GABC")).not.toThrow();
  });

  it("should throw for empty strings", () => {
    expect(() => validateNonEmptyString("address", "")).toThrow(
      SdkValidationError
    );
  });

  it("should throw for whitespace-only strings", () => {
    expect(() => validateNonEmptyString("address", "   ")).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-strings", () => {
    expect(() => validateNonEmptyString("address", null)).toThrow(
      SdkValidationError
    );
    expect(() => validateNonEmptyString("address", 123)).toThrow(
      SdkValidationError
    );
    expect(() => validateNonEmptyString("address", undefined)).toThrow(
      SdkValidationError
    );
  });
});

describe("validatePositiveBigInt", () => {
  it("should pass for positive bigints", () => {
    expect(() => validatePositiveBigInt("amount", 1n)).not.toThrow();
    expect(() => validatePositiveBigInt("amount", 1000n)).not.toThrow();
  });

  it("should throw for zero", () => {
    expect(() => validatePositiveBigInt("amount", 0n)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for negative bigints", () => {
    expect(() => validatePositiveBigInt("amount", -1n)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-bigints", () => {
    expect(() => validatePositiveBigInt("amount", 1)).toThrow(
      SdkValidationError
    );
    expect(() => validatePositiveBigInt("amount", "1")).toThrow(
      SdkValidationError
    );
  });
});

describe("validateNonNegativeBigInt", () => {
  it("should pass for zero and positive bigints", () => {
    expect(() => validateNonNegativeBigInt("limit", 0n)).not.toThrow();
    expect(() => validateNonNegativeBigInt("limit", 1000n)).not.toThrow();
  });

  it("should throw for negative bigints", () => {
    expect(() => validateNonNegativeBigInt("limit", -1n)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-bigints", () => {
    expect(() => validateNonNegativeBigInt("limit", 1)).toThrow(
      SdkValidationError
    );
  });
});

describe("validatePositiveNumber", () => {
  it("should pass for positive integers", () => {
    expect(() => validatePositiveNumber("tier", 1)).not.toThrow();
    expect(() => validatePositiveNumber("tier", 100)).not.toThrow();
  });

  it("should throw for zero", () => {
    expect(() => validatePositiveNumber("tier", 0)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for negative numbers", () => {
    expect(() => validatePositiveNumber("tier", -1)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-integers", () => {
    expect(() => validatePositiveNumber("tier", 1.5)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-numbers", () => {
    expect(() => validatePositiveNumber("tier", "1")).toThrow(
      SdkValidationError
    );
  });
});

describe("validateNonNegativeNumber", () => {
  it("should pass for zero and positive integers", () => {
    expect(() => validateNonNegativeNumber("tier", 0)).not.toThrow();
    expect(() => validateNonNegativeNumber("tier", 100)).not.toThrow();
  });

  it("should throw for negative numbers", () => {
    expect(() => validateNonNegativeNumber("tier", -1)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-integers", () => {
    expect(() => validateNonNegativeNumber("tier", 1.5)).toThrow(
      SdkValidationError
    );
  });
});

describe("validateThreshold", () => {
  it("should pass for valid threshold", () => {
    expect(() => validateThreshold("threshold", 3)).not.toThrow();
  });

  it("should pass when within max", () => {
    expect(() => validateThreshold("threshold", 3, 5)).not.toThrow();
  });

  it("should throw for zero", () => {
    expect(() => validateThreshold("threshold", 0)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for negative numbers", () => {
    expect(() => validateThreshold("threshold", -1)).toThrow(
      SdkValidationError
    );
  });

  it("should throw when exceeding max", () => {
    expect(() => validateThreshold("threshold", 6, 5)).toThrow(
      SdkValidationError
    );
  });
});

describe("validateMinInterval", () => {
  it("should pass for intervals >= 720", () => {
    expect(() => validateMinInterval("intervalLedgers", 720n)).not.toThrow();
    expect(() => validateMinInterval("intervalLedgers", 1000n)).not.toThrow();
  });

  it("should throw for intervals below 720", () => {
    expect(() => validateMinInterval("intervalLedgers", 719n)).toThrow(
      SdkValidationError
    );
    expect(() => validateMinInterval("intervalLedgers", 0n)).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-bigints", () => {
    expect(() => validateMinInterval("intervalLedgers", 720)).toThrow(
      SdkValidationError
    );
  });
});

describe("validateMemo", () => {
  it("should pass for non-empty strings up to 32 chars", () => {
    expect(() => validateMemo("memo", "short")).not.toThrow();
    expect(() => validateMemo("memo", "a".repeat(32))).not.toThrow();
  });

  it("should throw for empty strings", () => {
    expect(() => validateMemo("memo", "")).toThrow(SdkValidationError);
  });

  it("should throw for strings longer than 32 chars", () => {
    expect(() => validateMemo("memo", "a".repeat(33))).toThrow(
      SdkValidationError
    );
  });

  it("should throw for non-strings", () => {
    expect(() => validateMemo("memo", 123)).toThrow(SdkValidationError);
  });
});

describe("validateRole", () => {
  it("should pass for valid role values", () => {
    expect(() => validateRole("role", 0)).not.toThrow();
    expect(() => validateRole("role", 1)).not.toThrow();
    expect(() => validateRole("role", 2)).not.toThrow();
  });

  it("should throw for invalid role values", () => {
    expect(() => validateRole("role", 3)).toThrow(SdkValidationError);
    expect(() => validateRole("role", -1)).toThrow(SdkValidationError);
  });
});

describe("validateId", () => {
  it("should pass for positive bigints", () => {
    expect(() => validateId("proposalId", 1n)).not.toThrow();
    expect(() => validateId("proposalId", 100n)).not.toThrow();
  });

  it("should throw for zero", () => {
    expect(() => validateId("proposalId", 0n)).toThrow(SdkValidationError);
  });

  it("should throw for negative bigints", () => {
    expect(() => validateId("proposalId", -1n)).toThrow(SdkValidationError);
  });

  it("should throw for non-bigints", () => {
    expect(() => validateId("proposalId", 1)).toThrow(SdkValidationError);
  });
});

describe("validateStreamLedgers", () => {
  it("should pass when end > start", () => {
    expect(() =>
      validateStreamLedgers("startLedger", 0n, "endLedger", 100n)
    ).not.toThrow();
  });

  it("should throw when end <= start", () => {
    expect(() =>
      validateStreamLedgers("startLedger", 100n, "endLedger", 100n)
    ).toThrow(SdkValidationError);
    expect(() =>
      validateStreamLedgers("startLedger", 100n, "endLedger", 50n)
    ).toThrow(SdkValidationError);
  });

  it("should throw for negative values", () => {
    expect(() =>
      validateStreamLedgers("startLedger", -1n, "endLedger", 100n)
    ).toThrow(SdkValidationError);
  });
});

describe("validateInitConfig", () => {
  const validConfig = {
    signers: ["GAAA", "GBBB"],
    threshold: 2,
    spendingLimit: 1000n,
    dailyLimit: 5000n,
    weeklyLimit: 20000n,
    timelockThreshold: 500n,
    timelockDelay: 100n,
  };

  it("should pass for valid config", () => {
    expect(() => validateInitConfig(validConfig)).not.toThrow();
  });

  it("should throw for null config", () => {
    expect(() => validateInitConfig(null)).toThrow(SdkValidationError);
  });

  it("should throw for empty signers", () => {
    expect(() =>
      validateInitConfig({ ...validConfig, signers: [] })
    ).toThrow(SdkValidationError);
  });

  it("should throw for threshold below 1", () => {
    expect(() =>
      validateInitConfig({ ...validConfig, threshold: 0 })
    ).toThrow(SdkValidationError);
  });

  it("should throw for threshold exceeding signers count", () => {
    expect(() =>
      validateInitConfig({ ...validConfig, threshold: 3 })
    ).toThrow(SdkValidationError);
  });

  it("should throw for negative limits", () => {
    expect(() =>
      validateInitConfig({ ...validConfig, spendingLimit: -1n })
    ).toThrow(SdkValidationError);
  });
});

describe("Contract validation integration", () => {
  const defaultOpts = {
    contractId: "CXXXXXXXXX",
    rpcUrl: "http://localhost:8000/soroban/rpc",
    networkPassphrase: "Test SDF Network ; September 2015",
  };

  it("initialize should throw for empty admin key", async () => {
    await expect(
      initialize("", validConfig, defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("initialize should throw for invalid config", async () => {
    await expect(
      initialize("GAAA", { ...validConfig, threshold: 0 }, defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("proposeTransfer should throw for empty recipient", async () => {
    await expect(
      proposeTransfer("GPROPOSER", "", "CTOKEN", 100n, "memo", defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("proposeTransfer should throw for negative amount", async () => {
    await expect(
      proposeTransfer("GPROPOSER", "GRECEIVER", "CTOKEN", -1n, "memo", defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("proposeTransfer should throw for memo longer than 32 chars", async () => {
    await expect(
      proposeTransfer(
        "GPROPOSER",
        "GRECEIVER",
        "CTOKEN",
        100n,
        "a".repeat(33),
        defaultOpts
      )
    ).rejects.toThrow(SdkValidationError);
  });

  it("approveProposal should throw for empty signer key", async () => {
    await expect(approveProposal("", 1n, defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("approveProposal should throw for zero proposal id", async () => {
    await expect(approveProposal("GSIGNER", 0n, defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("executeProposal should throw for invalid executor", async () => {
    await expect(executeProposal("", 1n, defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("rejectProposal should throw for invalid rejector", async () => {
    await expect(rejectProposal("", 1n, defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("setRole should throw for invalid role", async () => {
    await expect(
      setRole("GADMIN", "GTARGET", 99 as Role, defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("updateLimits should throw for negative spending limit", async () => {
    await expect(
      updateLimits("GADMIN", -1n, 1000n, defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("updateThreshold should throw for threshold below 1", async () => {
    await expect(updateThreshold("GADMIN", 0, defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("schedulePayment should throw for interval below 720", async () => {
    await expect(
      schedulePayment(
        "GPROPOSER",
        "GRECEIVER",
        "CTOKEN",
        100n,
        "memo",
        100n,
        defaultOpts
      )
    ).rejects.toThrow(SdkValidationError);
  });

  it("createStream should throw for end ledger <= start ledger", async () => {
    await expect(
      createStream(
        "GSENDER",
        "GRECEIVER",
        "CTOKEN",
        1000n,
        10n,
        100n,
        50n,
        defaultOpts
      )
    ).rejects.toThrow(SdkValidationError);
  });

  it("createSubscription should throw for tier below 0", async () => {
    await expect(
      createSubscription(
        "GSUB",
        "GPROV",
        -1,
        "CTOKEN",
        100n,
        720n,
        defaultOpts
      )
    ).rejects.toThrow(SdkValidationError);
  });

  it("createEscrow should throw for zero amount", async () => {
    await expect(
      createEscrow("GFUNDER", "GREC", "CTOKEN", 0n, "GARB", 1000n, defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("addComment should throw for empty content", async () => {
    await expect(
      addComment("GAUTHOR", 1n, "", defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("proposeRecovery should throw for empty recovery type", async () => {
    await expect(
      proposeRecovery("GPROPOSER", "", defaultOpts)
    ).rejects.toThrow(SdkValidationError);
  });

  it("getProposal should throw for zero proposal id", async () => {
    await expect(getProposal(0n, "GCALLER", defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("getRole should throw for empty address", async () => {
    await expect(getRole("", "GCALLER", defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("getTodaySpent should throw for empty caller", async () => {
    await expect(getTodaySpent("", defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });

  it("isSigner should throw for empty address", async () => {
    await expect(isSigner("", "GCALLER", defaultOpts)).rejects.toThrow(
      SdkValidationError
    );
  });
});

const validConfig = {
  signers: ["GAAA", "GBBB"],
  threshold: 2,
  spendingLimit: 1000n,
  dailyLimit: 5000n,
  weeklyLimit: 20000n,
  timelockThreshold: 500n,
  timelockDelay: 100n,
};
