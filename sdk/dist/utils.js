"use strict";
/**
 * VaultDAO SDK — Utility Functions
 *
 * High-level helpers that wrap lower-level Stellar SDK operations.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.simulate_with_state_diff = exports.DEFAULT_RPC_URLS = exports.NETWORK_PASSPHRASES = void 0;
exports.buildOptions = buildOptions;
exports.connectWallet = connectWallet;
exports.buildTransaction = buildTransaction;
exports.signAndSubmit = signAndSubmit;
exports.parseError = parseError;
exports.addressToScVal = addressToScVal;
exports.i128ToScVal = i128ToScVal;
exports.u64ToScVal = u64ToScVal;
exports.u32ToScVal = u32ToScVal;
exports.symbolToScVal = symbolToScVal;
exports.decodeScVal = decodeScVal;
exports.getContract = getContract;
exports.extractStateDiff = extractStateDiff;
exports.simulateWithStateDiff = simulateWithStateDiff;
const stellar_sdk_1 = require("stellar-sdk");
const types_1 = require("./types");
const errors_1 = require("./errors");
// ---------------------------------------------------------------------------
// Network helpers
// ---------------------------------------------------------------------------
/** Known network passphrases keyed by preset name. */
exports.NETWORK_PASSPHRASES = {
    testnet: stellar_sdk_1.Networks.TESTNET,
    mainnet: stellar_sdk_1.Networks.PUBLIC,
    futurenet: stellar_sdk_1.Networks.FUTURENET,
};
/** Default RPC endpoints for known networks. */
exports.DEFAULT_RPC_URLS = {
    testnet: "https://soroban-testnet.stellar.org",
    mainnet: "https://mainnet.stellar.validationcloud.io/v1/REPLACE_ME",
    futurenet: "https://rpc-futurenet.stellar.org",
};
/**
 * Build an `SdkOptions` object from a network preset and contract ID.
 *
 * @param network    - One of the known network presets.
 * @param contractId - Deployed contract ID (Strkey Cxxx format).
 * @param overrides  - Optional overrides, including a custom {@link SdkLogger}.
 *
 * @example
 * const opts = buildOptions("testnet", "CXXXXXXXXX...");
 *
 * @example — with custom logger
 * const opts = buildOptions("testnet", "CXXXXXXXXX...", {
 *   logger: {
 *     debug: (msg, ctx) => console.debug(msg, ctx),
 *     info:  (msg, ctx) => console.info(msg, ctx),
 *     warn:  (msg, ctx) => console.warn(msg, ctx),
 *     error: (msg, ctx) => console.error(msg, ctx),
 *   },
 * });
 */
function buildOptions(network, contractId, overrides) {
    return {
        contractId,
        rpcUrl: overrides?.rpcUrl ?? exports.DEFAULT_RPC_URLS[network],
        networkPassphrase: overrides?.networkPassphrase ?? exports.NETWORK_PASSPHRASES[network],
        logger: overrides?.logger,
    };
}
/**
 * Connect to the Freighter browser extension and return wallet details.
 *
 * Throws if Freighter is not installed or the user rejects the connection.
 *
 * @example
 * const wallet = await connectWallet();
 * console.log(wallet.publicKey); // "GABC..."
 */
async function connectWallet() {
    // Dynamic import keeps the SDK usable in Node.js environments
    const freighter = await Promise.resolve().then(() => __importStar(require("@stellar/freighter-api")));
    const connected = await freighter.isConnected();
    if (!connected) {
        throw new Error("Freighter wallet is not installed. Install it at https://www.freighter.app/");
    }
    const publicKey = await freighter.getPublicKey();
    const details = await freighter.getNetworkDetails();
    return {
        publicKey,
        network: details.network,
        networkUrl: details.networkUrl,
    };
}
// ---------------------------------------------------------------------------
// Transaction building
// ---------------------------------------------------------------------------
/**
 * Prepare and simulate a Soroban contract invocation.
 *
 * Returns the prepared transaction ready to be signed and submitted.
 *
 * Emits logger events:
 * - `debug` before simulation
 * - `debug` after successful simulation
 * - `error` on simulation failure
 *
 * @param sourcePublicKey - The sender's public key.
 * @param operation       - The XDR operation to include.
 * @param opts            - SDK connection options.
 */
async function buildTransaction(sourcePublicKey, operation, opts) {
    const log = opts.logger ?? types_1.noopLogger;
    const server = new stellar_sdk_1.SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    const account = await server.getAccount(sourcePublicKey);
    const tx = new stellar_sdk_1.TransactionBuilder(account, {
        fee: stellar_sdk_1.BASE_FEE,
        networkPassphrase: opts.networkPassphrase,
    })
        .addOperation(operation)
        .setTimeout(30)
        .build();
    const simStart = Date.now();
    log.debug("Simulating transaction", {
        contractId: opts.contractId,
        sourcePublicKey,
    });
    const simResult = await server.simulateTransaction(tx);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(simResult)) {
        const durationMs = Date.now() - simStart;
        const err = parseSimulationError(simResult.error);
        log.error("Transaction simulation failed", {
            contractId: opts.contractId,
            errorMessage: err.message,
            durationMs,
        });
        throw err;
    }
    const durationMs = Date.now() - simStart;
    log.debug("Transaction simulation succeeded", {
        contractId: opts.contractId,
        durationMs,
    });
    const preparedTx = stellar_sdk_1.SorobanRpc.assembleTransaction(tx, simResult).build();
    return preparedTx.toXDR();
}
// ---------------------------------------------------------------------------
// Signing and submission
// ---------------------------------------------------------------------------
/**
 * Sign a transaction XDR with Freighter and submit it to the network.
 *
 * Emits logger events:
 * - `debug` before Freighter signing
 * - `debug` after signing
 * - `info` after successful submission
 * - `debug` while polling for confirmation
 * - `info` on transaction success
 * - `error` on transaction failure or timeout
 *
 * @param txXdr           - The base64 XDR of the prepared transaction.
 * @param opts            - SDK connection options.
 * @returns               The transaction hash on success.
 *
 * @example
 * const hash = await signAndSubmit(txXdr, opts);
 */
async function signAndSubmit(txXdr, opts) {
    const log = opts.logger ?? types_1.noopLogger;
    const freighter = await Promise.resolve().then(() => __importStar(require("@stellar/freighter-api")));
    log.debug("Requesting transaction signature from Freighter", {
        contractId: opts.contractId,
    });
    const signedXdr = await freighter.signTransaction(txXdr, {
        networkPassphrase: opts.networkPassphrase,
    });
    log.debug("Transaction signed, submitting to network", {
        contractId: opts.contractId,
    });
    const server = new stellar_sdk_1.SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    const { Transaction } = await Promise.resolve().then(() => __importStar(require("stellar-sdk")));
    const signedTx = new Transaction(signedXdr, opts.networkPassphrase);
    const sendResult = await server.sendTransaction(signedTx);
    if (sendResult.status === "ERROR") {
        const errorMessage = `Transaction failed: ${sendResult.errorResult}`;
        log.error("Transaction submission failed", {
            contractId: opts.contractId,
            errorMessage,
        });
        throw new Error(errorMessage);
    }
    const hash = sendResult.hash;
    log.info("Transaction submitted", {
        contractId: opts.contractId,
        txHash: hash,
    });
    // Poll for confirmation
    for (let i = 0; i < 30; i++) {
        await sleep(2000);
        const status = await server.getTransaction(hash);
        if (status.status === stellar_sdk_1.SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
            log.info("Transaction confirmed", {
                contractId: opts.contractId,
                txHash: hash,
                durationMs: (i + 1) * 2000,
            });
            return hash;
        }
        if (status.status === stellar_sdk_1.SorobanRpc.Api.GetTransactionStatus.FAILED) {
            log.error("Transaction reverted on-chain", {
                contractId: opts.contractId,
                txHash: hash,
                errorMessage: `Transaction reverted: ${hash}`,
            });
            throw new Error(`Transaction reverted: ${hash}`);
        }
        log.debug(`Polling transaction status (attempt ${i + 1}/30)`, {
            contractId: opts.contractId,
            txHash: hash,
        });
    }
    const timeoutMsg = `Transaction not confirmed after 60 seconds: ${hash}`;
    log.warn("Transaction confirmation timed out", {
        contractId: opts.contractId,
        txHash: hash,
        errorMessage: timeoutMsg,
    });
    throw new Error(timeoutMsg);
}
// ---------------------------------------------------------------------------
// Error parsing
// ---------------------------------------------------------------------------
/**
 * Parse a raw Soroban error string or XDR result into a `VaultError`
 * (if recognisable) or a plain `Error`.
 *
 * @example
 * try {
 *   await someContractCall();
 * } catch (err) {
 *   const parsed = parseError(err);
 *   if (parsed instanceof VaultError) {
 *     console.error("Contract error:", VaultErrorCode[parsed.code]);
 *   }
 * }
 */
function parseError(err) {
    if (err instanceof types_1.VaultError)
        return err;
    const message = err instanceof Error ? err.message : String(err);
    // Soroban contract errors surface as "Error(Contract, X)" in simulations
    const match = message.match(/Error\(Contract,\s*(\d+)\)/);
    if (match) {
        const code = parseInt(match[1], 10);
        if (code in types_1.VaultErrorCode) {
            const description = (0, errors_1.getErrorDescription)(code);
            return new types_1.VaultError(code, description);
        }
    }
    return err instanceof Error ? err : new Error(message);
}
function parseSimulationError(errorMessage) {
    return parseError(new Error(errorMessage));
}
// ---------------------------------------------------------------------------
// Conversion helpers (ScVal ↔ JS)
// ---------------------------------------------------------------------------
/** Convert a JS string to a Soroban Address ScVal. */
function addressToScVal(address) {
    return (0, stellar_sdk_1.nativeToScVal)(address, { type: "address" });
}
/** Convert a JS bigint to a Soroban i128 ScVal. */
function i128ToScVal(value) {
    return (0, stellar_sdk_1.nativeToScVal)(value, { type: "i128" });
}
/** Convert a JS bigint to a Soroban u64 ScVal. */
function u64ToScVal(value) {
    return (0, stellar_sdk_1.nativeToScVal)(value, { type: "u64" });
}
/** Convert a JS number to a Soroban u32 ScVal. */
function u32ToScVal(value) {
    return (0, stellar_sdk_1.nativeToScVal)(value, { type: "u32" });
}
/** Convert a JS string to a Soroban Symbol ScVal. */
function symbolToScVal(value) {
    return stellar_sdk_1.xdr.ScVal.scvSymbol(value);
}
/** Decode a raw ScVal into a native JS value. */
function decodeScVal(scVal) {
    return (0, stellar_sdk_1.scValToNative)(scVal);
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/**
 * Build an instance of the Stellar `Contract` class from SDK options.
 * @internal
 */
function getContract(opts) {
    return new stellar_sdk_1.Contract(opts.contractId);
}
// ---------------------------------------------------------------------------
// State Diff Extraction and Simulation (#1456)
// ---------------------------------------------------------------------------
/**
 * Extract state changes from simulation result object.
 */
function extractStateDiff(simResult) {
    const modifiedKeys = {};
    const newKeys = [];
    const changes = [];
    if (!simResult) {
        return { modifiedKeys, newKeys, changes };
    }
    const rawChanges = simResult.stateChanges ||
        simResult.state_changes ||
        simResult.changes ||
        (simResult.result && simResult.result.stateChanges) ||
        [];
    if (Array.isArray(rawChanges)) {
        for (const change of rawChanges) {
            const key = change.key || change.ledgerKey || change.id || String(change);
            const before = change.before !== undefined ? change.before : (change.previousValue ?? null);
            const after = change.after !== undefined ? change.after : (change.newValue ?? null);
            const isNew = before === null || before === undefined;
            const changeEntry = {
                key,
                before,
                after,
                isNew,
            };
            changes.push(changeEntry);
            if (isNew) {
                newKeys.push(key);
            }
            else {
                modifiedKeys[key] = { before, after };
            }
        }
    }
    else if (typeof rawChanges === "object") {
        for (const [key, val] of Object.entries(rawChanges)) {
            const before = val.before !== undefined ? val.before : null;
            const after = val.after !== undefined ? val.after : null;
            const isNew = before === null || before === undefined;
            changes.push({ key, before, after, isNew });
            if (isNew) {
                newKeys.push(key);
            }
            else {
                modifiedKeys[key] = { before, after };
            }
        }
    }
    return {
        modifiedKeys,
        newKeys,
        changes,
    };
}
/**
 * Simulate a transaction and return state diffs showing created and modified keys.
 */
async function simulateWithStateDiff(tx, opts) {
    if (typeof tx === "object" && tx !== null && ("modifiedKeys" in tx || "stateChanges" in tx)) {
        return extractStateDiff(tx);
    }
    if (!opts) {
        return extractStateDiff(tx);
    }
    const server = new stellar_sdk_1.SorobanRpc.Server(opts.rpcUrl, { allowHttp: false });
    let transactionObj = tx;
    if (typeof tx === "string") {
        transactionObj = stellar_sdk_1.TransactionBuilder.fromXDR(tx, opts.networkPassphrase);
    }
    const simResult = await server.simulateTransaction(transactionObj);
    if (stellar_sdk_1.SorobanRpc.Api.isSimulationError(simResult)) {
        const err = parseSimulationError(simResult.error);
        throw err;
    }
    return extractStateDiff(simResult);
}
/** Alias for snake_case callers */
exports.simulate_with_state_diff = simulateWithStateDiff;
//# sourceMappingURL=utils.js.map