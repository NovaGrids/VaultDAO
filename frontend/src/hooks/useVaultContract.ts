import { useState, useCallback } from 'react';
import {
    xdr,
    Address,
    Operation,
    TransactionBuilder,
    SorobanRpc,
    nativeToScVal,
    scValToNative
} from 'stellar-sdk';
import { useWallet } from './useWallet';
import { parseError } from '../utils/errorParser';
import { env } from '../config/env';
import { withRetry } from '../utils/retryUtils';
import type { VaultActivity, GetVaultEventsResult, VaultEventType } from '../types/activity';
import type { SimulationResult } from '../utils/simulation';
import type { Comment, ListMode } from '../types';
import type { TokenBalance } from '../types';
import type { TokenInfo } from '../constants/tokens';
import {
    getAllTrackedTokens,
    isValidStellarAddress,
    loadCustomTokens,
    saveCustomTokens,
} from '../constants/tokens';
import {
    generateCacheKey,
    getCachedSimulation,
    cacheSimulation,
    parseSimulationError,
    extractStateChanges,
    formatFeeBreakdown,
} from '../utils/simulation';

const EVENTS_PAGE_SIZE = 20;

const server = new SorobanRpc.Server(env.sorobanRpcUrl);

// Recurring Payment Types
export interface RecurringPayment {
    id: string;
    recipient: string;
    token: string;
    amount: string;
    memo: string;
    interval: number; // in seconds
    nextPaymentTime: number; // timestamp
    totalPayments: number;
    status: 'active' | 'paused' | 'cancelled';
    createdAt: number;
    creator: string;
}

export interface RecurringPaymentHistory {
    id: string;
    paymentId: string;
    executedAt: number;
    transactionHash: string;
    amount: string;
    success: boolean;
}

export interface CreateRecurringPaymentParams {
    recipient: string;
    token: string;
    amount: string;
    memo: string;
    interval: number; // in seconds
}

export interface VaultConfig {
    signers: string[];
    threshold: number;
    spendingLimit: string;
    dailyLimit: string;
    weeklyLimit: string;
    timelockThreshold: string;
    timelockDelay: number;
    currentUserRole: number;
    isCurrentUserSigner: boolean;
}

interface StellarBalance {
    asset_type: string;
    balance: string;
    asset_code?: string;
    asset_issuer?: string;
}

/** Known contract event names (topic[0] symbol) */
const EVENT_SYMBOLS: VaultEventType[] = [
    'proposal_created', 'proposal_approved', 'proposal_ready', 'proposal_executed',
    'proposal_rejected', 'signer_added', 'signer_removed', 'config_updated', 'initialized', 'role_assigned'
];

function getEventTypeFromTopic(topic0Base64: string): VaultEventType {
    try {
        const scv = xdr.ScVal.fromXDR(topic0Base64, 'base64');
        const native = scValToNative(scv);
        if (typeof native === 'string' && EVENT_SYMBOLS.includes(native as VaultEventType)) {
            return native as VaultEventType;
        }
        return 'unknown';
    } catch {
        return 'unknown';
    }
}

function addressToNative(addrScVal: unknown): string {
    if (typeof addrScVal === 'string') return addrScVal;
    if (addrScVal != null && typeof addrScVal === 'object') {
        const o = addrScVal as Record<string, unknown>;
        if (typeof o.address === 'function') return (o.address as () => string)();
        if (typeof o.address === 'string') return o.address;
    }
    return String(addrScVal ?? '');
}

function parseEventValue(valueXdrBase64: string, eventType: VaultEventType): { actor: string; details: Record<string, unknown> } {
    const details: Record<string, unknown> = {};
    let actor = '';
    try {
        const scv = xdr.ScVal.fromXDR(valueXdrBase64, 'base64');
        const native = scValToNative(scv);
        if (Array.isArray(native)) {
            const vec = native as unknown[];
            const first = vec[0];
            actor = addressToNative(first);
            if (eventType === 'proposal_created' && vec.length >= 3) {
                details.proposer = actor;
                details.recipient = addressToNative(vec[1]);
                details.amount = vec[2] != null ? String(vec[2]) : '';
            } else if (eventType === 'proposal_approved' && vec.length >= 3) {
                details.approval_count = vec[1];
                details.threshold = vec[2];
            } else if (eventType === 'proposal_executed' && vec.length >= 3) {
                details.recipient = addressToNative(vec[1]);
                details.amount = vec[2] != null ? String(vec[2]) : '';
            } else if ((eventType === 'signer_added' || eventType === 'signer_removed') && vec.length >= 2) {
                details.total_signers = vec[1];
            } else if (eventType === 'role_assigned' && vec.length >= 2) {
                details.role = vec[1];
            } else {
                details.raw = native;
            }
        } else {
            actor = addressToNative(native);
            if (native !== null && typeof native === 'object') {
                details.raw = native;
            }
        }
    } catch {
        details.parseError = true;
    }
    return { actor, details };
}

function parseNumericValue(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    if (typeof value === 'bigint') return Number(value);
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    }
    return 0;
}

function parseBigIntString(value: unknown): string {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value).toString();
    if (typeof value === 'string') {
        const normalized = value.trim();
        return normalized.length > 0 ? normalized : '0';
    }
    return '0';
}

function parseSignerAddresses(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.map((item) => addressToNative(item)).filter((item) => item.length > 0);
}

interface RawEvent {
    type: string;
    ledger: string;
    ledgerClosedAt?: string;
    contractId?: string;
    id: string;
    pagingToken?: string;
    inSuccessfulContractCall?: boolean;
    topic?: string[];
    value?: { xdr: string };
}

export const useVaultContract = () => {
    const { address, isConnected, signTransaction } = useWallet();
    const [loading, setLoading] = useState(false);
    const [recipientListMode, setRecipientListMode] = useState<ListMode>('Disabled');
    const [whitelistAddresses, setWhitelistAddresses] = useState<string[]>([]);
    const [blacklistAddresses, setBlacklistAddresses] = useState<string[]>([]);
    const [proposalComments, setProposalComments] = useState<Record<string, Comment[]>>({});

    const readContractValue = useCallback(async (functionName: string, args: xdr.ScVal[] = []): Promise<unknown> => {
        const source = address ?? env.contractId;
        const account = await server.getAccount(source);
        const tx = new TransactionBuilder(account, { fee: "100" })
            .setNetworkPassphrase(env.networkPassphrase)
            .setTimeout(30)
            .addOperation(Operation.invokeHostFunction({
                func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                    new xdr.InvokeContractArgs({
                        contractAddress: Address.fromString(env.contractId).toScAddress(),
                        functionName,
                        args,
                    })
                ),
                auth: [],
            }))
            .build();

        const simulation = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(simulation)) {
            throw new Error(simulation.error || `${functionName} simulation failed`);
        }
        const retval = (simulation as { result?: { retval?: unknown } })?.result?.retval;
        if (retval == null) return null;
        if (typeof retval === 'string') {
            try {
                return scValToNative(xdr.ScVal.fromXDR(retval, 'base64'));
            } catch {
                return null;
            }
        }
        try {
            return scValToNative(retval as xdr.ScVal);
        } catch {
            return null;
        }
    }, [address]);

    const getUserRole = useCallback(async (): Promise<number> => {
        if (!address) return 0;
        try {
            const role = await readContractValue('get_role', [new Address(address).toScVal()]);
            return parseNumericValue(role);
        } catch {
            return 0;
        }
    }, [address, readContractValue]);

    const getDashboardStats = useCallback(async () => {
        try {
            return await withRetry(async () => {
                const accountInfo = await server.getAccount(env.contractId) as unknown as { balances: StellarBalance[] };
                const nativeBalance = accountInfo.balances.find((b: StellarBalance) => b.asset_type === 'native');
                const balance = nativeBalance ? parseFloat(nativeBalance.balance).toLocaleString() : "0";
                return {
                    totalBalance: balance,
                    totalProposals: 24,
                    pendingApprovals: 3,
                    readyToExecute: 1,
                    activeSigners: 5,
                    threshold: "3/5"
                };
            }, { maxAttempts: 3, initialDelayMs: 1000 });
        } catch (e) {
            console.error("Failed to fetch dashboard stats:", e);
            return {
                totalBalance: "0",
                totalProposals: 0,
                pendingApprovals: 0,
                readyToExecute: 0,
                activeSigners: 0,
                threshold: "0/0"
            };
        }
    }, []);

    const getVaultConfig = useCallback(async (): Promise<VaultConfig> => {
        const [configRawPrimary, configRawLegacy, userRole, isSigner] = await Promise.all([
            readContractValue('get_config').catch(() => null),
            readContractValue('get_vault_config').catch(() => null),
            getUserRole(),
            address
                ? readContractValue('is_signer', [new Address(address).toScVal()]).then((value) => Boolean(value)).catch(() => false)
                : Promise.resolve(false),
        ]);

        const configRaw = configRawPrimary ?? configRawLegacy;
        const configObject = (configRaw && typeof configRaw === 'object') ? configRaw as Record<string, unknown> : {};

        const signers = parseSignerAddresses(configObject.signers);
        const threshold = parseNumericValue(configObject.threshold);
        const spendingLimit = parseBigIntString(configObject.spending_limit ?? configObject.spendingLimit);
        const dailyLimit = parseBigIntString(configObject.daily_limit ?? configObject.dailyLimit);
        const weeklyLimit = parseBigIntString(configObject.weekly_limit ?? configObject.weeklyLimit);
        const timelockThreshold = parseBigIntString(configObject.timelock_threshold ?? configObject.timelockThreshold);
        const timelockDelay = parseNumericValue(configObject.timelock_delay ?? configObject.timelockDelay);

        if (signers.length > 0 || threshold > 0) {
            return { signers, threshold, spendingLimit, dailyLimit, weeklyLimit, timelockThreshold, timelockDelay, currentUserRole: userRole, isCurrentUserSigner: isSigner };
        }

        const fallbackStats = await getDashboardStats();
        const [thresholdCount = '0', signerCount = '0'] = fallbackStats.threshold.split('/');
        const fallbackThreshold = Number.parseInt(thresholdCount, 10);
        const fallbackSignerCount = Number.parseInt(signerCount, 10);
        return {
            signers: Array.from({ length: Number.isFinite(fallbackSignerCount) ? fallbackSignerCount : 0 }, () => ''),
            threshold: Number.isFinite(fallbackThreshold) ? fallbackThreshold : 0,
            spendingLimit: '0', dailyLimit: '0', weeklyLimit: '0', timelockThreshold: '0', timelockDelay: 0,
            currentUserRole: userRole, isCurrentUserSigner: isSigner,
        };
    }, [address, getDashboardStats, getUserRole, readContractValue]);

    const proposeTransfer = async (recipient: string, token: string, amount: string, memo: string) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "propose_transfer",
                            args: [
                                new Address(address).toScVal(),
                                new Address(recipient).toScVal(),
                                new Address(token).toScVal(),
                                nativeToScVal(BigInt(amount)),
                                xdr.ScVal.scvSymbol(memo),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const approveProposal = async (proposalId: number) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "approve_proposal",
                            args: [
                                new Address(address).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const rejectProposal = async (proposalId: number) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "reject_proposal",
                            args: [
                                new Address(address).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const executeProposal = async (proposalId: number) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "execute_proposal",
                            args: [
                                new Address(address).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            if (response.status !== "PENDING") throw new Error("Transaction submission failed");
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const addSigner = async (signer: string) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "add_signer",
                            args: [new Address(address).toScVal(), new Address(signer).toScVal()],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const removeSigner = async (signer: string) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "remove_signer",
                            args: [new Address(address).toScVal(), new Address(signer).toScVal()],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const updateThreshold = async (newThreshold: number) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "update_threshold",
                            args: [new Address(address).toScVal(), nativeToScVal(BigInt(newThreshold), { type: "u32" })],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const updateSpendingLimits = async (proposalLimit: bigint, dailyLimit: bigint, weeklyLimit: bigint) => {
        if (!isConnected || !address) throw new Error("Wallet not connected");
        setLoading(true);
        try {
            const account = await server.getAccount(address);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "update_limits",
                            args: [
                                new Address(address).toScVal(),
                                nativeToScVal(proposalLimit),
                                nativeToScVal(dailyLimit),
                                nativeToScVal(weeklyLimit),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throw new Error(`Simulation Failed: ${simulation.error}`);
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            if (response.status !== "PENDING") throw new Error("Transaction submission failed");
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const getVaultEvents = async (
        cursor?: string,
        limit: number = EVENTS_PAGE_SIZE
    ): Promise<GetVaultEventsResult> => {
        try {
            const latestLedgerRes = await fetch(env.sorobanRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
            });
            const latestLedgerData = await latestLedgerRes.json();
            const latestLedger = latestLedgerData?.result?.sequence ?? '0';
            const startLedger = cursor ? undefined : Math.max(1, parseInt(latestLedger, 10) - 50000);

            const params: Record<string, unknown> = {
                filters: [{ type: 'contract', contractIds: [env.contractId] }],
                pagination: { limit: Math.min(limit, 200) },
            };
            if (!cursor) params.startLedger = String(startLedger);
            else params.pagination = { ...(params.pagination as object), cursor };

            const res = await fetch(env.sorobanRpcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'getEvents', params }),
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error.message || 'getEvents failed');
            const events: RawEvent[] = data.result?.events ?? [];
            const resultCursor = data.result?.cursor;
            const hasMore = Boolean(resultCursor && events.length === limit);

            const activities: VaultActivity[] = events.map(ev => {
                const topic0 = ev.topic?.[0];
                const valueXdr = ev.value?.xdr;
                const eventType = topic0 ? getEventTypeFromTopic(topic0) : 'unknown';
                const { actor, details } = valueXdr ? parseEventValue(valueXdr, eventType) : { actor: '', details: {} };
                return {
                    id: ev.id,
                    type: eventType,
                    timestamp: ev.ledgerClosedAt || new Date().toISOString(),
                    ledger: ev.ledger,
                    actor,
                    details: { ...details, ledger: ev.ledger },
                    eventId: ev.id,
                    pagingToken: ev.pagingToken,
                };
            });

            return { activities, latestLedger: data.result?.latestLedger ?? latestLedger, cursor: resultCursor, hasMore };
        } catch (e) {
            console.error('getVaultEvents', e);
            return { activities: [], latestLedger: '0', hasMore: false };
        }
    };

    const simulateTransaction = async (
        functionName: string,
        args: xdr.ScVal[],
        params?: Record<string, unknown>
    ): Promise<SimulationResult> => {
        if (!address) throw new Error("Wallet not connected");

        const cacheKey = generateCacheKey({ functionName, args: args.map(a => a.toXDR('base64')), address });
        const cached = getCachedSimulation(cacheKey);
        if (cached) return cached;

        try {
            const account = await server.getAccount(env.contractId);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName,
                            args,
                        })
                    ),
                    auth: [],
                }))
                .build();

            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) {
                const errorInfo = parseSimulationError(simulation);
                const result: SimulationResult = { success: false, fee: '0', feeXLM: '0', resourceFee: '0', error: errorInfo.message, errorCode: errorInfo.code, timestamp: Date.now() };
                cacheSimulation(cacheKey, result);
                return result;
            }

            const feeBreakdown = formatFeeBreakdown(simulation);
            const stateChanges = extractStateChanges(simulation, functionName, params);
            const result: SimulationResult = { success: true, fee: feeBreakdown.totalFee, feeXLM: feeBreakdown.totalFeeXLM, resourceFee: feeBreakdown.resourceFee, stateChanges, timestamp: Date.now() };
            cacheSimulation(cacheKey, result);
            return result;
        } catch (error: unknown) {
            const errorInfo = parseSimulationError(error);
            return { success: false, fee: '0', feeXLM: '0', resourceFee: '0', error: errorInfo.message, errorCode: errorInfo.code, timestamp: Date.now() };
        }
    };

    const simulateProposeTransfer = async (recipient: string, token: string, amount: string, memo: string): Promise<SimulationResult> => {
        if (!address) throw new Error("Wallet not connected");
        return simulateTransaction('propose_transfer', [
            new Address(address).toScVal(), new Address(recipient).toScVal(),
            new Address(token).toScVal(), nativeToScVal(BigInt(amount)), xdr.ScVal.scvSymbol(memo),
        ], { recipient, amount, memo });
    };

    const simulateApproveProposal = async (proposalId: number): Promise<SimulationResult> => {
        if (!address) throw new Error("Wallet not connected");
        return simulateTransaction('approve_proposal', [new Address(address).toScVal(), nativeToScVal(BigInt(proposalId), { type: "u64" })], { proposalId });
    };

    const simulateExecuteProposal = async (proposalId: number, amount?: string, recipient?: string): Promise<SimulationResult> => {
        if (!address) throw new Error("Wallet not connected");
        return simulateTransaction('execute_proposal', [new Address(address).toScVal(), nativeToScVal(BigInt(proposalId), { type: "u64" })], { proposalId, amount, recipient });
    };

    const simulateRejectProposal = async (proposalId: number): Promise<SimulationResult> => {
        if (!address) throw new Error("Wallet not connected");
        return simulateTransaction('reject_proposal', [new Address(address).toScVal(), nativeToScVal(BigInt(proposalId), { type: "u64" })], { proposalId });
    };

    const getProposalSignatures = useCallback(async (proposalId: number) => {
        console.log('Getting signatures for proposal:', proposalId);
        return Promise.resolve([
            { address: 'GABC...XYZ', name: 'Signer 1', signed: true, timestamp: new Date().toISOString() },
            { address: 'GDEF...UVW', name: 'Signer 2', signed: false, timestamp: undefined },
        ]);
    }, []);

    const remindSigner = useCallback(async (proposalId: number, signerAddress: string) => {
        console.log('Reminding signer:', signerAddress, 'for proposal:', proposalId);
        return Promise.resolve();
    }, []);

    const exportSignatures = useCallback(async (proposalId: number) => {
        console.log('Exporting signatures for proposal:', proposalId);
        return Promise.resolve();
    }, []);

    const getProposalComments = useCallback(async (proposalId: string): Promise<Comment[]> => {
        return proposalComments[proposalId] ?? [];
    }, [proposalComments]);

    const addComment = useCallback(async (proposalId: string, text: string, parentId: string = '0'): Promise<string> => {
        if (!address) throw new Error('Wallet not connected');
        const newComment: Comment = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            proposalId, author: address, text, parentId,
            createdAt: new Date().toISOString(), editedAt: '', replies: [],
        };
        setProposalComments((prev) => ({ ...prev, [proposalId]: [...(prev[proposalId] ?? []), newComment] }));
        return newComment.id;
    }, [address]);

    const editComment = useCallback(async (commentId: string, text: string): Promise<void> => {
        setProposalComments((prev) => {
            const updated: Record<string, Comment[]> = {};
            for (const [proposalId, comments] of Object.entries(prev)) {
                updated[proposalId] = comments.map((comment) =>
                    comment.id === commentId ? { ...comment, text, editedAt: new Date().toISOString() } : comment
                );
            }
            return updated;
        });
    }, []);

    const getListMode = useCallback(async (): Promise<ListMode> => recipientListMode, [recipientListMode]);
    const setListMode = useCallback(async (mode: ListMode): Promise<void> => { setRecipientListMode(mode); }, []);
    const addToWhitelist = useCallback(async (recipient: string): Promise<void> => { setWhitelistAddresses((prev) => (prev.includes(recipient) ? prev : [...prev, recipient])); }, []);
    const removeFromWhitelist = useCallback(async (recipient: string): Promise<void> => { setWhitelistAddresses((prev) => prev.filter((a) => a !== recipient)); }, []);
    const addToBlacklist = useCallback(async (recipient: string): Promise<void> => { setBlacklistAddresses((prev) => (prev.includes(recipient) ? prev : [...prev, recipient])); }, []);
    const removeFromBlacklist = useCallback(async (recipient: string): Promise<void> => { setBlacklistAddresses((prev) => prev.filter((a) => a !== recipient)); }, []);
    const isWhitelisted = useCallback(async (recipient: string): Promise<boolean> => whitelistAddresses.includes(recipient), [whitelistAddresses]);
    const isBlacklisted = useCallback(async (recipient: string): Promise<boolean> => blacklistAddresses.includes(recipient), [blacklistAddresses]);

    /**
     * Derive proposals from on-chain events.
     * Replays proposal_created, proposal_approved, proposal_rejected, proposal_executed
     * events to reconstruct current proposal state.
     */
    const getProposals = useCallback(async (): Promise<import('../app/dashboard/Proposals').Proposal[]> => {
        // Fetch all relevant events in one pass
        const result = await getVaultEvents(undefined, 200);
        const activities = result.activities;

        // Map to reconstruct proposal state keyed by proposal id
        const proposalMap = new Map<string, import('../app/dashboard/Proposals').Proposal>();

        // First pass: build proposals from creation events
        for (const ev of activities) {
            if (ev.type === 'proposal_created') {
                const d = ev.details as Record<string, unknown>;
                const id = String(ev.eventId.split('-')[0] ?? ev.eventId);
                proposalMap.set(id, {
                    id,
                    proposer: String(d.proposer ?? ev.actor ?? ''),
                    recipient: String(d.recipient ?? ''),
                    amount: String(d.amount ?? '0'),
                    token: 'NATIVE',
                    memo: String(d.memo ?? ''),
                    status: 'Pending',
                    approvals: 0,
                    threshold: 3,
                    approvedBy: [],
                    createdAt: ev.timestamp,
                });
            }
        }

        // Second pass: apply state transitions
        for (const ev of activities) {
            const id = String(ev.eventId.split('-')[0] ?? ev.eventId);
            const proposal = proposalMap.get(id);
            if (!proposal) continue;

            if (ev.type === 'proposal_approved') {
                const d = ev.details as Record<string, unknown>;
                const approvalCount = Number(d.approval_count ?? proposal.approvals + 1);
                const threshold = Number(d.threshold ?? proposal.threshold);
                const updatedApprovedBy = proposal.approvedBy.includes(ev.actor)
                    ? proposal.approvedBy
                    : [...proposal.approvedBy, ev.actor];
                proposalMap.set(id, {
                    ...proposal,
                    approvals: approvalCount,
                    threshold,
                    approvedBy: updatedApprovedBy,
                    status: approvalCount >= threshold ? 'Approved' : 'Pending',
                });
            } else if (ev.type === 'proposal_rejected') {
                proposalMap.set(id, { ...proposal, status: 'Rejected' });
            } else if (ev.type === 'proposal_executed') {
                proposalMap.set(id, { ...proposal, status: 'Executed' });
            } else if (ev.type === 'proposal_ready') {
                proposalMap.set(id, { ...proposal, status: 'Approved' });
            }
        }

        return Array.from(proposalMap.values()).sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
    }, [getVaultEvents]);

    /**
     * Fetch the vault's XLM balance from Horizon.
     */
    const getVaultBalance = useCallback(async (): Promise<string> => {
        try {
            const res = await fetch(`${env.horizonUrl}/accounts/${env.contractId}`);
            if (!res.ok) return '0';
            const data = await res.json() as { balances?: Array<{ asset_type: string; balance: string }> };
            const native = data.balances?.find(b => b.asset_type === 'native');
            // Return balance in stroops (multiply by 10^7)
            const xlm = parseFloat(native?.balance ?? '0');
            return Math.round(xlm * 1e7).toString();
        } catch {
            return '0';
        }
    }, []);

    /**
     * Fetch the vault's balance for a SAC token via contract simulation.
     * Returns human-readable balance string.
     */
    const fetchTokenBalance = useCallback(async (token: TokenInfo): Promise<string> => {
        if (token.isNative) {
            // XLM: use Horizon, return in XLM (not stroops)
            try {
                const res = await fetch(`${env.horizonUrl}/accounts/${env.contractId}`);
                if (!res.ok) return '0';
                const data = await res.json() as { balances?: Array<{ asset_type: string; balance: string }> };
                const native = data.balances?.find(b => b.asset_type === 'native');
                return native?.balance ?? '0';
            } catch {
                return '0';
            }
        }
        // SAC token: call token contract's balance() function
        try {
            const source = address ?? env.contractId;
            const account = await server.getAccount(source);
            const vaultAddress = Address.fromString(env.contractId);
            const tx = new TransactionBuilder(account, { fee: '100' })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(token.address).toScAddress(),
                            functionName: 'balance',
                            args: [vaultAddress.toScVal()],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) return '0';
            const retval = (simulation as { result?: { retval?: unknown } })?.result?.retval;
            if (retval == null) return '0';
            let raw: unknown;
            if (typeof retval === 'string') {
                try { raw = scValToNative(xdr.ScVal.fromXDR(retval, 'base64')); } catch { return '0'; }
            } else {
                try { raw = scValToNative(retval as xdr.ScVal); } catch { return '0'; }
            }
            // raw is i128 as bigint or number; convert to human-readable with decimals
            const rawNum = typeof raw === 'bigint' ? raw : BigInt(Math.trunc(Number(raw ?? 0)));
            const divisor = BigInt(10 ** token.decimals);
            const whole = rawNum / divisor;
            const frac = rawNum % divisor;
            if (frac === 0n) return whole.toString();
            const fracStr = frac.toString().padStart(token.decimals, '0').replace(/0+$/, '');
            return `${whole}.${fracStr}`;
        } catch {
            return '0';
        }
    }, [address]);

    /**
     * Fetch token metadata (symbol, name, decimals) from a SAC contract.
     */
    const fetchTokenMetadata = useCallback(async (tokenAddress: string): Promise<Partial<TokenInfo>> => {
        const source = address ?? env.contractId;
        try {
            const account = await server.getAccount(source);
            const contractAddr = Address.fromString(tokenAddress).toScAddress();

            const buildTx = (fn: string) => new TransactionBuilder(account, { fee: '100' })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({ contractAddress: contractAddr, functionName: fn, args: [] })
                    ),
                    auth: [],
                }))
                .build();

            const parseResult = async (fn: string): Promise<unknown> => {
                const sim = await server.simulateTransaction(buildTx(fn));
                if (SorobanRpc.Api.isSimulationError(sim)) return null;
                const retval = (sim as { result?: { retval?: unknown } })?.result?.retval;
                if (retval == null) return null;
                if (typeof retval === 'string') {
                    try { return scValToNative(xdr.ScVal.fromXDR(retval, 'base64')); } catch { return null; }
                }
                try { return scValToNative(retval as xdr.ScVal); } catch { return null; }
            };

            const [symbol, name, decimals] = await Promise.all([
                parseResult('symbol').catch(() => null),
                parseResult('name').catch(() => null),
                parseResult('decimals').catch(() => null),
            ]);

            return {
                symbol: typeof symbol === 'string' ? symbol : undefined,
                name: typeof name === 'string' ? name : undefined,
                decimals: typeof decimals === 'number' ? decimals : (typeof decimals === 'bigint' ? Number(decimals) : 7),
            };
        } catch {
            return {};
        }
    }, [address]);

    /**
     * Load balances for all tracked tokens (default + custom).
     * Each token is fetched independently so partial failures don't block others.
     */
    const getTokenBalances = useCallback(async (): Promise<TokenBalance[]> => {
        const tokens = getAllTrackedTokens();
        const results = await Promise.allSettled(
            tokens.map(async (token): Promise<TokenBalance> => {
                const balance = await fetchTokenBalance(token);
                return { token, balance, isLoading: false };
            })
        );
        return results
            .filter((r): r is PromiseFulfilledResult<TokenBalance> => r.status === 'fulfilled')
            .map(r => r.value);
    }, [fetchTokenBalance]);

    /**
     * Compute portfolio value by summing USD values.
     * Uses Stellar Expert price API for XLM; other tokens default to 0 if unavailable.
     */
    const getPortfolioValue = useCallback(async (): Promise<string> => {
        try {
            const balances = await getTokenBalances();
            // Fetch XLM price from Stellar Expert
            let xlmPrice = 0;
            try {
                const priceRes = await fetch('https://api.stellar.expert/explorer/testnet/asset/XLM/price');
                if (priceRes.ok) {
                    const priceData = await priceRes.json() as { price?: number };
                    xlmPrice = priceData.price ?? 0;
                }
            } catch { /* price unavailable */ }

            let total = 0;
            for (const tb of balances) {
                const amount = parseFloat(tb.balance);
                if (isNaN(amount) || amount <= 0) continue;
                if (tb.token.isNative) {
                    total += amount * xlmPrice;
                }
                // Non-native tokens: USD value unknown without price feed; skip for now
            }
            return total.toFixed(2);
        } catch {
            return '0';
        }
    }, [getTokenBalances]);

    /**
     * Add a custom token by address. Validates the address, fetches metadata
     * from the contract, persists to localStorage, and returns the TokenInfo.
     */
    const addCustomToken = useCallback(async (tokenAddress: string): Promise<TokenInfo | null> => {
        if (!isValidStellarAddress(tokenAddress)) {
            throw new Error('Invalid Stellar token address');
        }

        // Check for duplicates
        const existing = getAllTrackedTokens();
        if (existing.some(t => t.address === tokenAddress)) {
            throw new Error('Token already tracked');
        }

        // Fetch metadata from the contract
        const meta = await fetchTokenMetadata(tokenAddress);

        const tokenInfo: TokenInfo = {
            address: tokenAddress,
            symbol: meta.symbol ?? tokenAddress.slice(0, 6),
            name: meta.name ?? 'Unknown Token',
            decimals: meta.decimals ?? 7,
            isNative: false,
        };

        // Persist to localStorage
        const customTokens = loadCustomTokens();
        saveCustomTokens([...customTokens, tokenInfo]);

        return tokenInfo;
    }, [fetchTokenMetadata]);

    return {
        proposeTransfer, approveProposal, rejectProposal, executeProposal,
        addSigner, removeSigner, updateThreshold,
        getDashboardStats, getVaultEvents, loading,
        simulateProposeTransfer, simulateApproveProposal, simulateExecuteProposal, simulateRejectProposal,
        getProposalSignatures, remindSigner, exportSignatures,
        addComment, editComment, getProposalComments,
        getListMode, setListMode,
        addToWhitelist, removeFromWhitelist, addToBlacklist, removeFromBlacklist,
        isWhitelisted, isBlacklisted,
        getVaultConfig,
        getTokenBalances,
        getPortfolioValue,
        addCustomToken,
        getVaultBalance,
        getRecurringPayments: async () => [],
        getRecurringPaymentHistory: async () => [],
        schedulePayment: async () => "1",
        executeRecurringPayment: async () => { },
        cancelRecurringPayment: async () => { },
        getAllRoles: async () => [],
        setRole: async () => { },
        getUserRole,
        assignRole: async () => { },
        updateSpendingLimits,
        getProposals,
    };
};
