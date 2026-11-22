/**
 * VaultDAO e2e scenario runner (#2080)
 *
 * Usage:
 *   node --import tsx/esm runner.ts           # run all scenarios
 *   SCENARIOS=1,3 node --import tsx/esm runner.ts  # run only 1 and 3
 *
 * Required env vars:
 *   VAULT_CONTRACT_ID   — deployed contract address
 *   SOROBAN_RPC_URL     — (optional) defaults to Futurenet
 *   NETWORK_PASSPHRASE  — (optional) defaults to Futurenet passphrase
 *   TOKEN_ADDRESS       — (optional) SAC address for XLM on target network
 *   SKIP_FRIENDBOT      — set to "true" for local sandboxes that pre-fund
 *
 * Exits 0 if all selected scenarios pass, 1 if any failed.
 */

import { run as runVaultLifecycle }      from "./scenarios/01-vault-lifecycle.js";
import { run as runStreamPauseClawback } from "./scenarios/02-stream-pause-clawback.js";
import { run as runEscrowDisputeRecovery } from "./scenarios/03-escrow-dispute-recovery.js";
import { ArtifactCollector } from "./lib/artifacts.js";

// ---------------------------------------------------------------------------
// Scenario registry
// ---------------------------------------------------------------------------

interface Scenario {
  number: number;
  name: string;
  run: () => Promise<void>;
}

const ALL_SCENARIOS: Scenario[] = [
  { number: 1, name: "01-vault-lifecycle",        run: runVaultLifecycle },
  { number: 2, name: "02-stream-pause-clawback",  run: runStreamPauseClawback },
  { number: 3, name: "03-escrow-dispute-recovery", run: runEscrowDisputeRecovery },
];

// ---------------------------------------------------------------------------
// SCENARIOS filter
// ---------------------------------------------------------------------------

function selectedScenarios(): Scenario[] {
  const filter = process.env.SCENARIOS;
  if (!filter) return ALL_SCENARIOS;
  const nums = filter.split(",").map((s) => parseInt(s.trim(), 10));
  return ALL_SCENARIOS.filter((s) => nums.includes(s.number));
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface RunResult {
  scenario: string;
  status: "pass" | "fail" | "skip";
  artifactPath?: string;
  error?: string;
}

async function main(): Promise<void> {
  const scenarios = selectedScenarios();

  console.log("═".repeat(60));
  console.log("  VaultDAO e2e Scenario Pack");
  console.log(`  Contract: ${process.env.VAULT_CONTRACT_ID ?? "(not set — scenarios will skip)"}`);
  console.log(`  RPC:      ${process.env.SOROBAN_RPC_URL ?? "https://rpc-futurenet.stellar.org"}`);
  console.log(`  Running:  ${scenarios.map((s) => s.name).join(", ")}`);
  console.log("═".repeat(60));

  const results: RunResult[] = [];

  // Run sequentially to avoid RPC rate-limit issues.
  for (const scenario of scenarios) {
    const collector = new ArtifactCollector();
    try {
      await scenario.run();
      results.push({ scenario: scenario.name, status: "pass" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`\n❌  FAIL: ${scenario.name}\n   ${message}`);
      const artifactPath = await collector
        .save(scenario.name, "fail", message)
        .catch(() => "(artifact write failed)");
      results.push({
        scenario: scenario.name,
        status: "fail",
        artifactPath,
        error: message,
      });
    }
  }

  // Summary table
  console.log("\n" + "─".repeat(60));
  console.log("  SUMMARY");
  console.log("─".repeat(60));
  for (const r of results) {
    const icon = r.status === "pass" ? "✅" : r.status === "skip" ? "⏭️ " : "❌";
    const artifact = r.artifactPath ? `  → ${r.artifactPath}` : "";
    console.log(`  ${icon}  ${r.scenario}${artifact}`);
  }
  console.log("─".repeat(60));

  const failed = results.filter((r) => r.status === "fail").length;
  if (failed > 0) {
    console.log(`\n  ${failed} scenario(s) failed.\n`);
    process.exit(1);
  }
  console.log("\n  All scenarios passed.\n");
}

main().catch((err) => {
  console.error("Runner crashed:", err);
  process.exit(1);
});
