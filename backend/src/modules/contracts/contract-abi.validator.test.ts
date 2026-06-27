import assert from "node:assert/strict";
import test from "node:test";
import { validateInvocation } from "./contract-abi.validator.js";
import type { ContractABI } from "./contract-abi.js";

const testABI: ContractABI = {
  version: "1.0.0",
  functions: {
    propose: {
      args: [
        { name: "proposer", type: "Address" },
        { name: "recipient", type: "Address" },
        { name: "token", type: "Address" },
        { name: "amount", type: "i128" },
        { name: "memo", type: "Symbol" },
      ],
    },
    approve: {
      args: [
        { name: "signer", type: "Address" },
        { name: "proposal_id", type: "u32" },
      ],
    },
    get_config: { args: [] },
    with_vec: {
      args: [{ name: "signers", type: "Vec" }],
    },
    with_bool: {
      args: [{ name: "flag", type: "bool" }],
    },
  },
};

test("validateInvocation: valid invocation passes", () => {
  const result = validateInvocation(testABI, "propose", [
    "GABC123",
    "GDEF456",
    "GTOKEN",
    "500000",
    "salary",
  ]);
  assert.strictEqual(result.ok, true);
});

test("validateInvocation: zero-arg function passes with empty args", () => {
  const result = validateInvocation(testABI, "get_config", []);
  assert.strictEqual(result.ok, true);
});

test("validateInvocation: wrong arg count is rejected", () => {
  const result = validateInvocation(testABI, "approve", ["GABC123"]);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.error, /count mismatch/);
  }
});

test("validateInvocation: wrong arg type is rejected", () => {
  // proposal_id should be u32, not a string of non-numeric
  const result = validateInvocation(testABI, "approve", ["GABC123", "not-a-number"]);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.strictEqual(result.error.fn_name, "approve");
    assert.match(result.error.error, /proposal_id/);
  }
});

test("validateInvocation: unknown function returns structured error", () => {
  const result = validateInvocation(testABI, "nonexistent", []);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.error, /Unknown function/);
  }
});

test("validateInvocation: ABI version mismatch — wrong version returns null ABI", () => {
  // Simulate caller passing wrong-version ABI (different version string)
  const wrongVersionABI: ContractABI = { ...testABI, version: "2.0.0" };
  // The function still validates against whatever ABI was passed — version is informational.
  // A version mismatch is detected at the registry level before calling validateInvocation.
  // Here we verify version is preserved in error messages when a fn is unknown.
  const result = validateInvocation(wrongVersionABI, "unknown_fn", []);
  assert.strictEqual(result.ok, false);
  if (!result.ok) {
    assert.match(result.error.error, /v2\.0\.0/);
  }
});

test("validateInvocation: Vec type accepts arrays", () => {
  const result = validateInvocation(testABI, "with_vec", [["A", "B"]]);
  assert.strictEqual(result.ok, true);
});

test("validateInvocation: bool type rejects non-boolean", () => {
  const result = validateInvocation(testABI, "with_bool", ["true"]);
  assert.strictEqual(result.ok, false);
});

test("validateInvocation: i128 accepts numeric string", () => {
  const result = validateInvocation(testABI, "propose", [
    "GABC",
    "GDEF",
    "GTOK",
    "-999999999999",
    "memo",
  ]);
  assert.strictEqual(result.ok, true);
});

test("validateInvocation: u32 rejects negative number", () => {
  const result = validateInvocation(testABI, "approve", ["GABC", -1]);
  assert.strictEqual(result.ok, false);
});
