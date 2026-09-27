#!/bin/bash
# VaultDAO Testnet Deployment Script
# Deploys the VaultDAO contract to Stellar testnet

set -e

NETWORK=${1:-testnet}
ADMIN_SECRET=${2:-}
CONTRACT_NAME="vault_dao"

if [ -z "$ADMIN_SECRET" ]; then
    echo "Usage: ./deploy_testnet.sh [testnet|futurenet] <admin_secret_key>"
    echo "Example: ./deploy_testnet.sh testnet SBXXXXXX..."
    exit 1
fi

# Build contract
echo "Building contract..."
cargo build --release --target wasm32-unknown-unknown

# Get compiled WASM
WASM_FILE="target/wasm32-unknown-unknown/release/${CONTRACT_NAME}.wasm"
if [ ! -f "$WASM_FILE" ]; then
    echo "Error: WASM file not found at $WASM_FILE"
    exit 1
fi

echo "WASM file: $WASM_FILE"
echo "Network: $NETWORK"
echo "Admin secret: ${ADMIN_SECRET:0:10}..."

# Deploy using Stellar CLI
echo "Deploying to $NETWORK..."
soroban contract deploy \
    --network "$NETWORK" \
    --source-account "$ADMIN_SECRET" \
    --wasm "$WASM_FILE"

echo "Deployment complete!"
echo "Contract ready for integration testing on $NETWORK"
