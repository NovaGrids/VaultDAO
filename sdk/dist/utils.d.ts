/**
 * VaultDAO SDK — Utility Functions
 *
 * High-level helpers that wrap lower-level Stellar SDK operations.
 */
import { Contract, xdr } from "stellar-sdk";
import type { SdkOptions, Network, StateDiff } from "./types";
import { VaultError } from "./types";
/** Known network passphrases keyed by preset name. */
export declare const NETWORK_PASSPHRASES: Record<Exclude<Network, "custom">, string>;
/** Default RPC endpoints for known networks. */
export declare const DEFAULT_RPC_URLS: Record<Exclude<Network, "custom">, string>;
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
export declare function buildOptions(network: Exclude<Network, "custom">, contractId: string, overrides?: Partial<Pick<SdkOptions, "rpcUrl" | "networkPassphrase" | "logger">>): SdkOptions;
export interface WalletConnection {
    publicKey: string;
    network: string;
    networkUrl: string;
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
export declare function connectWallet(): Promise<WalletConnection>;
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
export declare function buildTransaction(sourcePublicKey: string, operation: xdr.Operation, opts: SdkOptions): Promise<string>;
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
export declare function signAndSubmit(txXdr: string, opts: SdkOptions): Promise<string>;
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
export declare function parseError(err: unknown): VaultError | Error;
/** Convert a JS string to a Soroban Address ScVal. */
export declare function addressToScVal(address: string): xdr.ScVal;
/** Convert a JS bigint to a Soroban i128 ScVal. */
export declare function i128ToScVal(value: bigint): xdr.ScVal;
/** Convert a JS bigint to a Soroban u64 ScVal. */
export declare function u64ToScVal(value: bigint): xdr.ScVal;
/** Convert a JS number to a Soroban u32 ScVal. */
export declare function u32ToScVal(value: number): xdr.ScVal;
/** Convert a JS string to a Soroban Symbol ScVal. */
export declare function symbolToScVal(value: string): xdr.ScVal;
/** Decode a raw ScVal into a native JS value. */
export declare function decodeScVal(scVal: xdr.ScVal): unknown;
/**
 * Build an instance of the Stellar `Contract` class from SDK options.
 * @internal
 */
export declare function getContract(opts: SdkOptions): Contract;
/**
 * Extract state changes from simulation result object.
 */
export declare function extractStateDiff(simResult: any): StateDiff;
/**
 * Simulate a transaction and return state diffs showing created and modified keys.
 */
export declare function simulateWithStateDiff(tx: string | any, opts?: SdkOptions): Promise<StateDiff>;
/** Alias for snake_case callers */
export declare const simulate_with_state_diff: typeof simulateWithStateDiff;
//# sourceMappingURL=utils.d.ts.map