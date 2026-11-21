/**
 * Scenario 03 — Escrow Dispute / Recovery
 *
 * Simulates the dispute + recovery path:
 *  1. Generate fresh keypairs (admin, treasurer, counterparty, arbitrator)
 *  2. Fund all via friendbot
 *  3. Initialize vault (threshold=1)
 *  4. Set roles: treasurer=Treasurer, arbitrator=DisputeArbitrator
 *  5. Propose + approve + execute a transfer to counterparty
 *     (simulates funds entering an escrow-like arrangement)
 *  6. Create a second proposal (the "disputed" one)
 *  7. Admin cancels the second proposal (simulates dispute resolution /
 *     recovery: admin overrides on behalf of the DAO)
 *  8. Assert cancellation record exists for the second proposal
 *  9. Save artifact
 *
 * Parallel-safe: every run uses freshly generated keypairs.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { ArtifactCollector } from "../lib/artifacts.js";
import { fundAccount } from "../lib/network.js";
import { VaultClient } from "../lib/vault-client.js";
import { getContractId, getRpcUrl, getNetworkPassphrase } from "../lib/network.js";

const SCENARIO = "03-escrow-dispute-recovery";

const ESCROW_AMOUNT  = 500_000_000n;         // 50 XLM
const DISPUTE_AMOUNT = 200_000_000n;         // 20 XLM
const SPENDING_LIMIT = 50_000_000_000n;
const DAILY_LIMIT    = 500_000_000_000n;
const WEEKLY_LIMIT   = 3_500_000_000_000n;

export async function run(): Promise<void> {
  const contractId = getContractId();
  if (!contractId) {
    console.log(`SKIP: ${SCENARIO} — VAULT_CONTRACT_ID not set`);
    return;
  }

  const collector = new ArtifactCollector();
  const client = new VaultClient(getRpcUrl(), getNetworkPassphrase(), contractId);

  console.log(`\n▶  ${SCENARIO}`);

  // Step 1 — keypairs
  const admin        = Keypair.random();
  const treasurer    = Keypair.random();
  const counterparty = Keypair.random();
  const arbitrator   = Keypair.random();
  collector.addNote(`admin:        ${admin.publicKey()}`);
  collector.addNote(`treasurer:    ${treasurer.publicKey()}`);
  collector.addNote(`counterparty: ${counterparty.publicKey()}`);
  collector.addNote(`arbitrator:   ${arbitrator.publicKey()}`);

  // Step 2 — fund
  console.log("  Funding accounts…");
  await fundAccount(admin.publicKey());
  await fundAccount(treasurer.publicKey());
  await fundAccount(counterparty.publicKey());
  await fundAccount(arbitrator.publicKey());

  // Step 3 — initialize vault
  console.log("  Initializing vault…");
  const initTx = await client.initialize(
    admin,
    admin.publicKey(),
    [admin.publicKey(), treasurer.publicKey()],
    1,
    SPENDING_LIMIT,
    DAILY_LIMIT,
    WEEKLY_LIMIT
  );
  collector.addTx(initTx.txHash, initTx.ledger);

  // Step 4 — roles
  console.log("  Setting roles…");
  const roleTreasurerTx = await client.setRole(
    admin, admin.publicKey(), treasurer.publicKey(), "Treasurer"
  );
  collector.addTx(roleTreasurerTx.txHash, roleTreasurerTx.ledger);

  const roleArbitratorTx = await client.setRole(
    admin, admin.publicKey(), arbitrator.publicKey(), "DisputeArbitrator"
  );
  collector.addTx(roleArbitratorTx.txHash, roleArbitratorTx.ledger);

  // Admin also needs Treasurer to propose
  const roleAdminTx = await client.setRole(
    admin, admin.publicKey(), admin.publicKey(), "Treasurer"
  );
  collector.addTx(roleAdminTx.txHash, roleAdminTx.ledger);

  const tokenAddress =
    process.env.TOKEN_ADDRESS ??
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

  // Step 5 — first proposal: escrow payment to counterparty
  console.log("  Proposing escrow transfer (proposal 1)…");
  const propose1Tx = await client.proposeTransfer(
    admin,
    admin.publicKey(),
    counterparty.publicKey(),
    tokenAddress,
    ESCROW_AMOUNT
  );
  collector.addTx(propose1Tx.txHash, propose1Tx.ledger);
  collector.addNote(`escrow proposal ID: ${propose1Tx.proposalId}`);

  console.log("  Approving escrow proposal…");
  const approve1Tx = await client.approveProposal(
    admin, admin.publicKey(), propose1Tx.proposalId
  );
  collector.addTx(approve1Tx.txHash, approve1Tx.ledger);

  console.log("  Executing escrow proposal…");
  const exec1Tx = await client.executeProposal(
    admin, admin.publicKey(), propose1Tx.proposalId
  );
  collector.addTx(exec1Tx.txHash, exec1Tx.ledger);
  collector.addNote(`escrow proposal ${propose1Tx.proposalId} executed ✓`);

  // Step 6 — second (disputed) proposal
  console.log("  Proposing disputed transfer (proposal 2)…");
  const propose2Tx = await client.proposeTransfer(
    admin,
    admin.publicKey(),
    counterparty.publicKey(),
    tokenAddress,
    DISPUTE_AMOUNT
  );
  collector.addTx(propose2Tx.txHash, propose2Tx.ledger);
  collector.addNote(`disputed proposal ID: ${propose2Tx.proposalId}`);

  // Step 7 — admin cancels the disputed proposal (recovery/dispute override)
  console.log("  Admin cancelling disputed proposal (recovery path)…");
  const cancelTx = await client.cancelProposal(
    admin,
    admin.publicKey(),
    propose2Tx.proposalId,
    "dispute"
  );
  collector.addTx(cancelTx.txHash, cancelTx.ledger);

  // Step 8 — assert cancellation record exists
  console.log("  Verifying cancellation record…");
  const record = await client.getCancellationRecord(propose2Tx.proposalId);
  if (!record) {
    throw new Error(
      `No cancellation record found for proposal ${propose2Tx.proposalId}`
    );
  }
  collector.addNote(
    `cancellation record for proposal ${propose2Tx.proposalId} exists ✓`
  );

  // Step 9 — save
  await collector.save(SCENARIO, "pass");
  console.log(`✅  PASS: ${SCENARIO}`);
}
