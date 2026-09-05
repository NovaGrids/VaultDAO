# VaultDAO Testnet Integration Testing

This guide covers deploying VaultDAO to Stellar testnet and running integration tests.

## Prerequisites

1. Soroban CLI installed:
```bash
cargo install soroban-cli
```

2. Stellar account with test XLM (get from https://stellar.org/lumens/testnet-lab)

3. Test accounts configured in `.env` or environment variables

## Setup

### 1. Build the Contract

```bash
cd contracts/vault
cargo build --release --target wasm32-unknown-unknown
```

### 2. Deploy to Testnet

Using the provided script:
```bash
chmod +x scripts/deploy_testnet.sh
./scripts/deploy_testnet.sh testnet SBXXXXXXXX...
```

Or manually with Soroban CLI:
```bash
soroban contract deploy \
    --network testnet \
    --source-account SBXXXXXXXX... \
    --wasm target/wasm32-unknown-unknown/release/vault_dao.wasm
```

This returns a Contract ID (e.g., `CXXXXXXXX...`)

## Integration Test Scenarios

### Test 1: Full Proposal Workflow
```
Initialize vault
  ↓
Create transfer proposal
  ↓
Collect approvals from 2 signers
  ↓
Execute proposal
  ↓
Verify token transfer
```

### Test 2: Approval Process
```
Create proposal
  ↓
Signer 1 approves
  ↓
Signer 2 approves (threshold met)
  ↓
Proposal auto-executes (if configured)
```

### Test 3: Vote Changes
```
Create proposal
  ↓
Signer 1 approves
  ↓
Signer 1 changes vote to reject
  ↓
Verify vote updated in contract state
```

### Test 4: Abstention Handling
```
Create proposal
  ↓
Signer 1 approves
  ↓
Signer 2 abstains
  ↓
Verify quorum calculation includes abstention
```

### Test 5: Cancellation
```
Create proposal
  ↓
Proposer cancels before threshold
  ↓
Verify proposal status changed to Cancelled
```

## Configuration

Create `.env` file in contracts/vault:
```
TESTNET_CONTRACT_ID=CXXXXXXXX...
TESTNET_ADMIN_SECRET=SBXXXXXXXX...
TESTNET_SIGNER1_SECRET=SBXXXXXXXX...
TESTNET_SIGNER2_SECRET=SBXXXXXXXX...
TESTNET_RECIPIENT=GXXXXXXXX...
TESTNET_RPC_URL=https://soroban-testnet.stellar.org
```

## Running Integration Tests

Local tests (no testnet required):
```bash
cargo test --test '*'
```

Testnet integration tests (requires setup):
```bash
TESTNET_ENABLED=true cargo test --features testnet test_full_proposal_workflow
```

## Test Results Logging

Each test logs:
- Proposal creation transaction hash
- Approval transaction hashes
- Execution transaction hash
- Ledger sequence numbers
- Gas costs

Logs saved to: `testnet_integration_results.log`

## Troubleshooting

### Contract Deployment Fails
- Verify account has sufficient XLM balance (>10 XLM)
- Check network parameter (testnet vs futurenet)
- Ensure WASM file compiled successfully

### Transaction Fails with "Insufficient Balance"
- Use testnet lab to fund account: https://stellar.org/lumens/testnet-lab
- Wait a few seconds between transactions

### Proposal Not Executing
- Verify threshold configuration
- Check approval count vs required signers
- Review contract state with `soroban contract read` if possible

## Success Criteria

✓ Contract deploys without errors
✓ Proposals can be created and stored
✓ Approvals register correctly
✓ Execution occurs when threshold met
✓ Vote changes update proposal state
✓ Abstentions counted in quorum
✓ Cancellations prevent execution
