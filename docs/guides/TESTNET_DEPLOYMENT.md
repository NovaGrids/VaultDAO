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
