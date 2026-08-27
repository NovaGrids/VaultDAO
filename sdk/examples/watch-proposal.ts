/**
 * Example: Watch a proposal for on-chain lifecycle changes.
 *
 * Usage:
 *   npx tsx examples/watch-proposal.ts
 */

import { buildOptions, watchProposal } from "@vaultdao/sdk";

const opts = buildOptions(
  "testnet",
  "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
  { logger: console }
);

const unsubscribe = watchProposal(opts, 1n, (change) => {
  console.log(
    `Proposal #${change.proposalId} changed via ${change.eventType} ` +
    `(status ${change.status}) at ledger ${change.ledger}`
  );
});

process.once("SIGINT", () => {
  unsubscribe();
  process.exit(0);
});