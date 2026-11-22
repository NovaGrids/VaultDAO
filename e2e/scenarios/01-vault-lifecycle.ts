/**
 * Scenario 01 — Vault Lifecycle
 *
 * Steps:
 *  1. Generate fresh keypairs (admin, signer1, signer2, recipient)
 *  2. Fund all four via friendbot
 *  3. Initialize vault (threshold=2)
 *  4. Grant Treasurer role to signer1 and signer2
 *  5. Propose a transfer of 100 XLM to recipient
 *  6. signer1 approves
 *  7. signer2 approves → triggers Approved status (threshold=2 met)
 *  8. Execute proposal
 *  9. Assert proposal.status === "Executed"
 * 10. Save artifact
 *
 * Parallel-safe: every run uses freshly generated keypairs.
 */

import { Keypair } from "@stellar/stellar-sdk";
import { ArtifactCollector } from "../lib/artifacts.js";
import { fundAccount } from "../lib/network.js";
import { VaultClient } from "../lib/vault-client.js";
import { getContractId, getRpcUrl, getNetworkPassphrase } from "../lib/network.js";

const SCENARIO = "01-vault-lifecycle";

// 100 XLM in stroops
const TRANSFER_AMOUNT = 1_000_000_000n;
// 5 000 XLM spending limit
const SPENDING_LIMIT = 50_000_000_000n;
const DAILY_LIMIT   = 500_000_000_000n;
const WEEKLY_LIMIT  = 3_500_000_000_000n;

export async function run(): Promise<void> {
  const contractId = getContractId();
  if (!contractId) {
    console.log(`SKIP: ${SCENARIO} — VAULT_CONTRACT_ID not set`);
    return;
  }

  const collector = new ArtifactCollector();
  const client = new VaultClient(getRpcUrl(), getNetworkPassphrase(), contractId);

  console.log(`\n▶  ${SCENARIO}`);

  // Step 1 — generate keypairs
  const admin     = Keypair.random();
  const signer1   = Keypair.random();
  const signer2   = Keypair.random();
  const recipient = Keypair.random();
  collector.addNote(`admin:     ${admin.publicKey()}`);
  collector.addNote(`signer1:   ${signer1.publicKey()}`);
  collector.addNote(`signer2:   ${signer2.publicKey()}`);
  collector.addNote(`recipient: ${recipient.publicKey()}`);

  // Step 2 — fund
  console.log("  Funding accounts…");
  await fundAccount(admin.publicKey());
  await fundAccount(signer1.publicKey());
  await fundAccount(signer2.publicKey());
  await fundAccount(recipient.publicKey());

  // Step 3 — initialize vault
  console.log("  Initializing vault…");
  const initTx = await client.initialize(
    admin,
    admin.publicKey(),
    [admin.publicKey(), signer1.publicKey(), signer2.publicKey()],
    2,
    SPENDING_LIMIT,
    DAILY_LIMIT,
    WEEKLY_LIMIT
  );
  collector.addTx(initTx.txHash, initTx.ledger);
  collector.addNote(`vault initialized at ledger ${initTx.ledger}`);

  // Step 4 — grant Treasurer to signer1 and signer2
  console.log("  Setting roles…");
  const role1Tx = await client.setRole(admin, admin.publicKey(), signer1.publicKey(), "Treasurer");
  collector.addTx(role1Tx.txHash, role1Tx.ledger);
  const role2Tx = await client.setRole(admin, admin.publicKey(), signer2.publicKey(), "Treasurer");
  collector.addTx(role2Tx.txHash, role2Tx.ledger);

  // Also grant admin Treasurer so they can propose
  const roleAdminTx = await client.setRole(admin, admin.publicKey(), admin.publicKey(), "Treasurer");
  collector.addTx(roleAdminTx.txHash, roleAdminTx.ledger);

  // Step 5 — propose transfer
  // Use native XLM token address (SAC) — in a real run this would be the
  // SAC contract for XLM on the target network. We use a placeholder here;
  // CI can set TOKEN_ADDRESS to override.
  const tokenAddress =
    process.env.TOKEN_ADDRESS ??
    "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"; // Futurenet XLM SAC

  console.log("  Proposing transfer…");
  const proposeTx = await client.proposeTransfer(
    admin,
    admin.publicKey(),
    recipient.publicKey(),
    tokenAddress,
    TRANSFER_AMOUNT
  );
  collector.addTx(proposeTx.txHash, proposeTx.ledger);
  collector.addNote(`proposal ID: ${proposeTx.proposalId}`);

  // Step 6 — signer1 approves
  console.log("  signer1 approving…");
  const approve1Tx = await client.approveProposal(signer1, signer1.publicKey(), proposeTx.proposalId);
  collector.addTx(approve1Tx.txHash, approve1Tx.ledger);

  // Step 7 — signer2 approves (threshold reached)
  console.log("  signer2 approving…");
  const approve2Tx = await client.approveProposal(signer2, signer2.publicKey(), proposeTx.proposalId);
  collector.addTx(approve2Tx.txHash, approve2Tx.ledger);

  // Step 8 — execute
  console.log("  Executing proposal…");
  const execTx = await client.executeProposal(admin, admin.publicKey(), proposeTx.proposalId);
  collector.addTx(execTx.txHash, execTx.ledger);

  // Step 9 — assert Executed
  console.log("  Verifying status…");
  const proposal = await client.getProposal(proposeTx.proposalId);
  const status = (proposal.status as { tag?: string })?.tag ?? proposal.status;
  if (status !== "Executed") {
    throw new Error(`Expected proposal status Executed, got: ${JSON.stringify(status)}`);
  }
  collector.addNote(`proposal ${proposeTx.proposalId} status: ${JSON.stringify(status)} ✓`);

  // Step 10 — save
  await collector.save(SCENARIO, "pass");
  console.log(`✅  PASS: ${SCENARIO}`);
}
