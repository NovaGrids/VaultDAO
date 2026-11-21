# Testnet Deployment Guide

This document describes the automated testnet deployment process for VaultDAO smart contracts.

## Overview

Automated testnet deployments are triggered on each merge to the `main` branch. The deployment process:

1. Builds the contract WASM binary
2. Optimizes the binary for size
3. Deploys to Stellar Testnet
4. Runs integration tests
5. Sends deployment notifications

## Deployment Workflow

### Automatic Deployment (Main Branch)

When code is merged to `main`:

```
1. Build contract → 2. Deploy to testnet → 3. Verify → 4. Notify
```

### Manual Deployment

Trigger manual deployment via GitHub Actions UI:

1. Go to Actions tab
2. Select "Deploy to Testnet" workflow
3. Click "Run workflow"
4. Select environment (testnet or staging)
5. Click "Run workflow"

## Required Secrets

Configure these secrets in GitHub repository settings:

| Secret | Description | Example |
|--------|-------------|---------|
| `TESTNET_SOURCE_ACCOUNT` | Testnet account for deployment | `GXXXXXXXXX...` |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint | `https://soroban-testnet.stellar.org` |
| `SLACK_WEBHOOK_URL` | Slack webhook for notifications | `https://hooks.slack.com/...` |
| `DISCORD_WEBHOOK_URL` | Discord webhook for notifications | `https://discordapp.com/api/webhooks/...` |

### Setting Up Secrets

1. Go to Repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add each required secret

## Deployment Environment Setup

### Install Soroban CLI

```bash
cargo install --locked soroban-cli --version 21.5.0
```

### Create Testnet Account

```bash
soroban config identity create testnet-deployer
soroban config network add testnet \
  --rpc-url https://soroban-testnet.stellar.org \
  --network-passphrase "Test SDF Network ; September 2015"
```

### Fund Account

1. Visit https://laboratory.stellar.org/#account-creator
2. Create testnet account or fund existing
3. Verify balance: `soroban account balance --source testnet-deployer --network testnet`

## Deployed Contracts

Latest deployed contracts are stored in GitHub Actions artifacts.

### Accessing Contract ID

**From workflow output:**
1. Go to Actions → Deploy to Testnet
2. Click latest successful run
3. Scroll to "Outputs"
4. Find "contract-id"

**From Stellar Expert:**
Visit: `https://stellar.expert/explorer/testnet/contract/{CONTRACT_ID}`

## Testing Deployed Contract

### Run Integration Tests

```bash
export TESTNET_CONTRACT_ID=CDXXXXXXX...
export SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
npm run backend:test
```

### Manual Contract Calls

```bash
soroban contract invoke \
  --id CDXXXXXXX... \
  --source testnet-deployer \
  --network testnet \
  -- \
  <method_name> <args>
```

## Verification Checklist

After deployment, verify:

- [ ] Deployment workflow completed successfully
- [ ] Contract ID available in workflow outputs
- [ ] Contract verifiable on Stellar Expert
- [ ] Integration tests passed
- [ ] Slack/Discord notification received
- [ ] Can invoke contract functions

## Rollback Procedure

If deployment fails or contract has issues:

1. **Do not merge** problematic code to main
2. **Fix issues** on feature branch
3. **Run tests** locally
4. **Create PR** and merge only after verification
5. **New deployment** will occur automatically

## Performance Considerations

- Deployments take ~2-5 minutes
- WASM optimization reduces contract size by ~20-30%
- Integration tests run against deployed contract
- All steps cached for faster subsequent runs

## Monitoring

### Check Deployment Status

```bash
soroban contract info \
  --contract CDXXXXXXX... \
  --network testnet
```

### View Transaction History

Visit Stellar Expert:
`https://stellar.expert/explorer/testnet/contract/{CONTRACT_ID}/events`

## Troubleshooting

### Deployment Fails

1. Check GitHub Actions logs
2. Verify Testnet Source Account has funds
3. Ensure Soroban RPC URL is accessible
4. Review contract compilation errors

### Integration Tests Fail

1. Verify contract functionality
2. Check test environment variables
3. Review test logs in GitHub Actions
4. Consider contract state/data issues

### Notifications Not Sent

1. Verify webhook URLs in secrets
2. Check webhook connectivity
3. Review notification payload in logs
4. Test webhooks manually

## Contract Lifecycle

1. **Development**: Feature branch testing
2. **Testing**: PR integration tests
3. **Staging**: Testnet deployment on merge
4. **Production**: Manual deployment to mainnet (future)

## Next Steps

- View deployed contract: `https://stellar.expert/explorer/testnet/contract/{CONTRACT_ID}`
- Test contract functionality with provided tools
- Monitor contract performance and gas usage
- Plan mainnet deployment after thorough testing

---

## E2E Scenario Pack (#2080)

The `e2e/` directory contains a hermetic, parallel-safe scenario suite that
exercises the full cross-module flow against Futurenet (or any Soroban-compatible
sandbox). Unlike unit tests, these scenarios send real transactions and verify
on-chain state through the RPC, catching failures that only manifest when multiple
contract modules interact.

### Scenarios

| # | File | What it covers |
|---|------|----------------|
| 1 | `scenarios/01-vault-lifecycle.ts` | Create vault → fund → propose → 2-of-2 approve → execute → assert Executed |
| 2 | `scenarios/02-stream-pause-clawback.ts` | Create stream → assert Active → pause → assert Paused → resume → assert Active → cancel → assert Cancelled |
| 3 | `scenarios/03-escrow-dispute-recovery.ts` | Propose + execute escrow transfer → propose second → admin cancels (recovery) → assert cancellation record exists |

### Running Locally

```bash
cd e2e
npm install

# Point at a deployed contract
export VAULT_CONTRACT_ID=CDXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
export SOROBAN_RPC_URL=https://rpc-futurenet.stellar.org
export NETWORK_PASSPHRASE="Test SDF Future Network ; October 2022"

# Optional: override the XLM SAC address for the target network
export TOKEN_ADDRESS=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC

# Run all scenarios
node --import tsx/esm runner.ts

# Run only specific scenarios (e.g. 1 and 3)
SCENARIOS=1,3 node --import tsx/esm runner.ts
```

Each scenario generates fresh keypairs for every run — you can run multiple
instances in parallel without key conflicts.

### Local Sandbox (no friendbot)

If you're running against a local `stellar/quickstart` sandbox that pre-funds
accounts at genesis, set `SKIP_FRIENDBOT=true`:

```bash
export SOROBAN_RPC_URL=http://localhost:8000/soroban/rpc
export NETWORK_PASSPHRASE="Standalone Network ; February 2017"
export SKIP_FRIENDBOT=true
node --import tsx/esm runner.ts
```

### CI / Nightly Workflow

The `.github/workflows/e2e-testnet.yml` workflow runs nightly at 03:00 UTC
and can also be triggered manually from the Actions UI.

**Required secrets** (set in repo Settings → Secrets → Actions):

| Secret | Description |
|--------|-------------|
| `VAULT_CONTRACT_ID` | Deployed contract address on Futurenet |
| `E2E_TOKEN_ADDRESS` | XLM SAC address on the target network (optional) |

The manual dispatch also accepts `vault_contract_id`, `soroban_rpc_url`,
`network_passphrase`, and `scenarios` as inputs, so you can target a specific
deployment without changing secrets.

### Artifacts and Failure Diagnosis

Every scenario writes a JSON artifact to `e2e/e2e-artifacts/` regardless of
pass or fail. On CI, the `e2e-artifacts-<run-id>` artifact is uploaded and
retained for 30 days.

Each artifact contains:

```json
{
  "scenario": "01-vault-lifecycle",
  "timestamp": "2026-08-28T03:12:45.123Z",
  "status": "fail",
  "txHashes": ["abc123…", "def456…"],
  "ledgers": [1234567, 1234568],
  "error": "Expected proposal status Executed, got: Pending",
  "notes": [
    "admin:     GAXXX…",
    "proposal ID: 1",
    "vault initialized at ledger 1234566"
  ]
}
```

**To diagnose a failure:**

1. Download the `e2e-artifacts-<run-id>` artifact from the failed Actions run.
2. Open the JSON file for the failing scenario.
3. Copy any `txHashes` entry and look it up on Stellar Expert:
   `https://stellar.expert/explorer/futurenet/tx/<hash>`
4. Check the `notes` array for the keypairs used — you can query their
   account history on Stellar Expert to see which call failed and why.
5. Reproduce locally with the same contract ID and RPC:

```bash
export VAULT_CONTRACT_ID=<id-from-artifact>
export SOROBAN_RPC_URL=https://rpc-futurenet.stellar.org
SCENARIOS=1 node --import tsx/esm runner.ts
```

### Adding a New Scenario

1. Create `e2e/scenarios/0N-<name>.ts` following the pattern of the existing
   three files: generate fresh keypairs, fund, run steps, assert, save artifact.
2. Import and register it in `e2e/runner.ts` with the next scenario number.
3. Document it in the table above.
4. Test it locally before opening a PR:
   `SCENARIOS=N node --import tsx/esm runner.ts`
