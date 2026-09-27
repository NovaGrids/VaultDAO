/**
 * Batch Proposal Orchestration Example (#1457)
 *
 * Demonstrates the full workflow of orchestrating batch proposals:
 * 1. Builder pattern: add multiple transfers
 * 2. Create all proposals
 * 3. Approve proposals from multiple signers
 * 4. Execute approved proposals
 * 5. Track state and errors throughout
 */

import { createBatchOrchestrator } from "@vaultdao/sdk";
import type { SdkOptions } from "@vaultdao/sdk";

// Example SDK configuration
const sdkOptions: SdkOptions = {
  contractId: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  logger: {
    debug: (msg, ctx) => console.log("[DEBUG]", msg, ctx),
    info: (msg, ctx) => console.log("[INFO]", msg, ctx),
    warn: (msg, ctx) => console.warn("[WARN]", msg, ctx),
    error: (msg, ctx) => console.error("[ERROR]", msg, ctx),
  },
};

async function main() {
  console.log("=== VaultDAO Batch Proposal Orchestration Example ===\n");

  // Create orchestrator with custom retry configuration
  const orchestrator = createBatchOrchestrator(sdkOptions, {
    maxAttempts: 3,
    initialBackoffMs: 1000,
    maxBackoffMs: 10000,
  });

  // Example 1: Builder pattern for adding transfers
  console.log("1. Adding transfers using builder pattern...");

  orchestrator
    .addTransfer({
      recipientPublicKey: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 1000n,
      description: "Monthly salary - Alice",
    })
    .addTransfer({
      recipientPublicKey: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBSC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 1500n,
      description: "Monthly salary - Bob",
    })
    .addTransfer({
      recipientPublicKey: "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCSC4",
      tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
      amount: 2000n,
      description: "Contractor payment - Carol",
    });

  const transfers = orchestrator.getTransfers();
  console.log(`✓ Added ${transfers.length} transfers to batch`);
  console.log(`  Total amount: ${transfers.reduce((sum, t) => sum + t.amount, 0n)} stroops\n`);

  // Example 2: Track proposal IDs after creation
  console.log("2. Simulating proposal creation...");

  // In production, you would call orchestrator.createProposals()
  // For this example, we'll manually add proposal IDs as they would come from events
  orchestrator.addCreatedProposalIds(["proposal-1", "proposal-2", "proposal-3"]);

  const createdIds = orchestrator.getCreatedProposalIds();
  console.log(`✓ Tracked ${createdIds.length} proposals created`);
  console.log(`  Proposal IDs: ${createdIds.join(", ")}\n`);

  // Example 3: Track approvals
  console.log("3. Simulating approval tracking...");

  // Simulate approvals from multiple signers
  for (const proposalId of createdIds) {
    await orchestrator.approveProposal(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      proposalId
    );
  }

  console.log(`✓ All proposals approved by first signer\n`);

  // Example 4: Execute proposals
  console.log("4. Simulating proposal execution...");

  // In production, you would call orchestrator.executeAllProposals()
  // For this example, manually track execution
  const executedIds = orchestrator.getExecutedProposalIds();
  console.log(`✓ Ready to execute ${createdIds.length} proposals\n`);

  // Example 5: Get full orchestration state
  console.log("5. Current orchestration state:");

  const state = orchestrator.getState();
  console.log(`  Transfers added: ${state.transfers.length}`);
  console.log(`  Proposals created: ${state.createdProposalIds.length}`);
  console.log(`  Proposals executed: ${state.executedProposalIds.length}`);
  console.log(`  Approval counts: ${state.approvalCounts.size} unique proposals`);
  console.log(`  Errors recorded: ${state.errors.length}\n`);

  // Example 6: Advanced - Reset and retry pattern
  console.log("6. Reset pattern for retry scenarios...");

  const newBatch = createBatchOrchestrator(sdkOptions);

  // Add a single high-value transfer that needs special handling
  newBatch.addTransfer({
    recipientPublicKey: "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDSC4",
    tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    amount: 10_000_000n, // High value - likely needs timelock
    description: "Large payment - requires special approval",
  });

  console.log(`✓ Created new batch with high-value transfer`);
  console.log(`  Amount: ${newBatch.getTransfers()[0]?.amount} stroops\n`);

  // Example 7: Error handling
  console.log("7. Error handling example:");

  // Simulate recording errors
  const failedBatch = createBatchOrchestrator(sdkOptions, {
    maxAttempts: 1,
  });

  failedBatch.addTransfer({
    recipientPublicKey: "GEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEEESC4",
    tokenAddress: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
    amount: 500n,
  });

  try {
    // This would fail in production due to invalid proposal ID
    await failedBatch.approveProposal(
      "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAASC4",
      "invalid-proposal-id"
    );
  } catch {
    // Error caught and recorded
  }

  const errors = failedBatch.getErrors();
  if (errors.length > 0) {
    console.log(`✓ Recorded ${errors.length} orchestration errors:`);
    for (const error of errors) {
      console.log(`  - ${error.step}: ${error.error}`);
    }
  }

  console.log("\n=== Example Complete ===");
  console.log(
    "Key features demonstrated:\n" +
    "✓ Builder pattern for fluent API\n" +
    "✓ State tracking across operations\n" +
    "✓ Retry logic with exponential backoff\n" +
    "✓ Error recording for diagnostics\n" +
    "✓ Flexible proposal ID handling\n" +
    "✓ Full orchestration workflow\n"
  );
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
