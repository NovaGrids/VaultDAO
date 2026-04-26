import { useState, useCallback, useEffect } from 'react';
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
import { parseError, type VaultError } from '../utils/errorParser';

/** Throw a VaultError from a Soroban simulation failure string. */
function throwSimulationError(simulationError: string | undefined, fallback: string): never {
  const raw = simulationError || fallback;
  throw parseError(new Error(raw));
}
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
import { eventPayloadDigest } from '../utils/auditVerification';

const EVENTS_PAGE_SIZE = 20;

const server = new SorobanRpc.Server(env.sorobanRpcUrl);

const RECIPIENT_LIST_STORAGE_PREFIX = 'vault_recipient_lists';
const normalizeRecipientAddress = (recipient: string): string => recipient.trim();
const dedupeRecipients = (addresses: string[]): string[] => {
    const normalized = addresses.map(normalizeRecipientAddress).filter((address) => address.length > 0);
    return Array.from(new Set(normalized));
};

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

export interface RoleAssignment {
    address: string;
    role: number;
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

// Type definitions for Soroban RPC responses and contract interactions
interface SorobanRpcEvent {
  type: string;
  ledgerClosedAt?: string;
  value?: {
    xdr?: string;
  };
  eventId?: string;
  contractId?: string;
  topic?: string[];
}

interface SorobanRpcResponse<T> {
  result?: T;
  status: string;
  latestLedger?: string;
}

interface SorobanGetEventsResponse {
  events: SorobanRpcEvent[];
  latestLedger: string;
  cursor?: string;
}

interface SorobanSimulationResult {
  result?: {
    retval: xdr.ScVal;
    auth?: Array<unknown>;
  };
  error?: string;
  events?: SorobanRpcEvent[];
  latestLedger?: string;
}

interface SorobanSendTransactionResponse {
  status: string;
  hash?: string;
  ledger?: number;
  errorResult?: string;
}

interface ContractStorageEntry {
  key: string;
  val: unknown;
}

interface SignerConfig {
  address?: string | (() => string);
  role?: unknown;
}

interface ProposalEventData {
  proposer?: string;
  recipient?: string;
  amount?: string;
  approval_count?: unknown;
  threshold?: unknown;
  total_signers?: unknown;
  role?: unknown;
  raw?: unknown;
}

function addressToNative(addrScVal: unknown): string {
    if (typeof addrScVal === 'string') return addrScVal;
    if (addrScVal != null && typeof addrScVal === 'object') {
        const o = addrScVal as SignerConfig;
        if (typeof o.address === 'function') return (o.address as () => string)();
        if (typeof o.address === 'string') return o.address;
    }
    return String(addrScVal ?? '');
}

function parseEventValue(valueXdrBase64: string, eventType: VaultEventType): { actor: string; details: ProposalEventData } {
    const details: ProposalEventData = {};
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

interface RoleAssignmentRecord {
    address?: string;
    addr?: string;
    role?: unknown;
}

function parseRoleAssignments(value: unknown): RoleAssignment[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (item == null || typeof item !== 'object') return null;
            const record = item as RoleAssignmentRecord;
            const addressValue = record.address ?? record.addr;
            const roleValue = record.role;
            const address = addressToNative(addressValue);
            const role = parseNumericValue(roleValue);
            if (!address || !isValidStellarAddress(address)) return null;
            if (![0, 1, 2].includes(role)) return null;
            return { address, role };
        })
        .filter((assignment): assignment is RoleAssignment => assignment != null);
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
    const { address, isConnected, network, signTransaction } = useWallet();

    /**
     * Preflight check for mutation actions.
     * Throws a user-friendly error if the wallet or network is not ready.
     * Returns the non-null address for use in the calling function.
     */
    const assertReady = useCallback((): string => {
        if (!isConnected || !address) {
            const err: VaultError = { code: 'WALLET_NOT_CONNECTED', message: 'Please connect your wallet before performing this action.' };
            throw err;
        }
        if (network && network.toUpperCase() !== env.stellarNetwork.toUpperCase()) {
            const err: VaultError = { code: 'NETWORK_MISMATCH', message: `Wrong network. Please switch your wallet to ${env.stellarNetwork}.` };
            throw err;
        }
        if (!env.contractId) {
            const err: VaultError = { code: 'CONTRACT_NOT_CONFIGURED', message: 'Contract is not configured. Check your environment settings.' };
            throw err;
        }
        return address;
    }, [isConnected, address, network]);
    const recipientStorageKey = `${RECIPIENT_LIST_STORAGE_PREFIX}_${env.contractId}`;
    const loadRecipientState = useCallback((): { mode: ListMode; whitelist: string[]; blacklist: string[] } => {
        try {
            const stored = localStorage.getItem(recipientStorageKey);
            if (!stored) {
                return { mode: 'Disabled', whitelist: [], blacklist: [] };
            }
            const parsed = JSON.parse(stored) as { mode?: ListMode; whitelist?: string[]; blacklist?: string[] };
            const mode: ListMode = parsed.mode === 'Whitelist' || parsed.mode === 'Blacklist' ? parsed.mode : 'Disabled';
            return {
                mode,
                whitelist: dedupeRecipients(Array.isArray(parsed.whitelist) ? parsed.whitelist : []),
                blacklist: dedupeRecipients(Array.isArray(parsed.blacklist) ? parsed.blacklist : []),
            };
        } catch {
            return { mode: 'Disabled', whitelist: [], blacklist: [] };
        }
    }, [recipientStorageKey]);

    const initialRecipientState = loadRecipientState();
    const [loading, setLoading] = useState(false);
    const [recipientListMode, setRecipientListMode] = useState<ListMode>(initialRecipientState.mode);
    const [whitelistAddresses, setWhitelistAddresses] = useState<string[]>(initialRecipientState.whitelist);
    const [blacklistAddresses, setBlacklistAddresses] = useState<string[]>(initialRecipientState.blacklist);
    const [proposalComments, setProposalComments] = useState<Record<string, Comment[]>>({});

    useEffect(() => {
        localStorage.setItem(
            recipientStorageKey,
            JSON.stringify({
                mode: recipientListMode,
                whitelist: dedupeRecipients(whitelistAddresses),
                blacklist: dedupeRecipients(blacklistAddresses),
            }),
        );
    }, [recipientListMode, whitelistAddresses, blacklistAddresses, recipientStorageKey]);

    const readContractValue = useCallback(async (functionName: string, args: xdr.ScVal[] = []): Promise<unknown> => {
        const source = address ?? env.feesAccount;
        let account;
        try {
            account = await server.getAccount(source);
        } catch (error) {
            console.warn(`Failed to load account for read operation (${source}):`, error);
            throw new Error(`Unable to perform read operation: invalid source account (${source})`);
        }
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
            throwSimulationError(simulation.error, `${functionName} simulation failed`);
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
// Fetch balance, config, and proposals in parallel
const [accountInfo, configResult, proposalsResult] = await Promise.allSettled([
    server.getAccount(env.contractId) as Promise<unknown>,
    readContractValue('get_config').catch(() => null).then(r =>
        r ?? readContractValue('get_vault_config').catch(() => null)),
    // Inline event fetch to avoid forward-reference to getVaultEvents
    (async () => {
        const latestRes = await fetch(env.sorobanRpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
        });
        const latestData = await latestRes.json() as { result?: { sequence?: number } };
        const latestLedger = latestData?.result?.sequence ?? 0;
        const startLedger = Math.max(1, latestLedger - 50000);
        const evRes = await fetch(env.sorobanRpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0', id: 2, method: 'getEvents',
                params: {
                    startLedger: String(startLedger),
                    filters: [{ type: 'contract', contractIds: [env.contractId] }],
                    pagination: { limit: 200 },
                },
            }),
        });
        const evData = await evRes.json() as { result?: { events?: RawEvent[] } };
        return evData.result?.events ?? [];
    })(),
]);

// --- Balance ---
let balance = '0';
if (accountInfo.status === 'fulfilled') {
    const info = accountInfo.value as { balances?: StellarBalance[] };
    const native = info.balances?.find(b => b.asset_type === 'native');
    if (native) balance = parseFloat(native.balance).toLocaleString();
}

interface StellarBalance {
    asset_type: string;
    balance: string;
}

interface VaultConfig {
    signers?: unknown;
    threshold?: unknown;
    [key: string]: unknown;
}

interface ProposalStatus {
    status: string;
    approvals: number;
    threshold: number;
}

// --- Signer / threshold from config ---
let activeSigners = 0;
let threshold = '0/0';
if (configResult.status === 'fulfilled' && configResult.value) {
    const cfg = configResult.value as VaultConfig;
    const signers = parseSignerAddresses(cfg.signers);
    const t = parseNumericValue(cfg.threshold);
    activeSigners = signers.length;
    threshold = `${t}/${activeSigners}`;
}

// --- Proposal counts from events ---
let totalProposals = 0;
let pendingApprovals = 0;
let readyToExecute = 0;
if (proposalsResult.status === 'fulfilled') {
    const events: RawEvent[] = proposalsResult.value;
    const proposalMap = new Map<string, ProposalStatus>();
    for (const ev of events) {
        const topic0 = ev.topic?.[0];
        if (!topic0) continue;
        const evType = getEventTypeFromTopic(topic0);
        const id = String(ev.id.split('-')[0] ?? ev.id);
        if (evType === 'proposal_created') {
            proposalMap.set(id, { status: 'Pending', approvals: 0, threshold: 3 });
        }
    }
    for (const ev of events) {
        const topic0 = ev.topic?.[0];
        if (!topic0) continue;
        const evType = getEventTypeFromTopic(topic0);
        const id = String(ev.id.split('-')[0] ?? ev.id);
        const p = proposalMap.get(id);
        if (!p) continue;
        if (evType === 'proposal_approved') {
            const valueXdr = ev.value?.xdr;
            const { details } = valueXdr ? parseEventValue(valueXdr, evType) : { details: {} as ProposalEventData };
            const d = details as ProposalEventData;
            const approvals = Number(d.approval_count ?? p.approvals + 1);
            const t = Number(d.threshold ?? p.threshold);
            proposalMap.set(id, { ...p, approvals, threshold: t, status: approvals >= t ? 'Approved' : 'Pending' });
        } else if (evType === 'proposal_rejected') {
            proposalMap.set(id, { ...p, status: 'Rejected' });
        } else if (evType === 'proposal_executed') {
            proposalMap.set(id, { ...p, status: 'Executed' });
        } else if (evType === 'proposal_ready') {
            proposalMap.set(id, { ...p, status: 'Approved' });
        }
    }
    const proposals = Array.from(proposalMap.values());
    totalProposals = proposals.filter(p => p.status !== 'Executed' && p.status !== 'Rejected').length;
    pendingApprovals = proposals.filter(p => p.status === 'Pending').length;
    readyToExecute = proposals.filter(p => p.status === 'Approved').length;
}

return { totalBalance: balance, totalProposals, pendingApprovals, readyToExecute, activeSigners, threshold };
}, { maxAttempts: 3, initialDelayMs: 1000 });
} catch (e) {
    console.error("Failed to fetch dashboard stats:", e);
    return { totalBalance: '0', totalProposals: 0, pendingApprovals: 0, readyToExecute: 0, activeSigners: 0, threshold: '0/0' };
}
}, [readContractValue]);

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
        const configObject = (configRaw && typeof configRaw === 'object') ? configRaw as VaultConfig : {};

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

        // Fallback: derive signer count from Horizon account data
        let fallbackSignerCount = 0;
        const fallbackThreshold = 0;
        try {
            const accountInfo = await server.getAccount(env.contractId) as unknown as { signers?: Array<unknown> };
            fallbackSignerCount = Array.isArray(accountInfo.signers) ? accountInfo.signers.length : 0;
        } catch { /* ignore */ }
        return {
            signers: Array.from({ length: fallbackSignerCount }, () => ''),
            threshold: fallbackThreshold,
            spendingLimit: '0', dailyLimit: '0', weeklyLimit: '0', timelockThreshold: '0', timelockDelay: 0,
            currentUserRole: userRole, isCurrentUserSigner: isSigner,
        };
    }, [address, getUserRole, readContractValue]);

    const proposeTransfer = async (recipient: string, token: string, amount: string, memo: string) => {
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "propose_transfer",
                            args: [
                                new Address(_addr).toScVal(),
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
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
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
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "approve_proposal",
                            args: [
                                new Address(_addr).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
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
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "reject_proposal",
                            args: [
                                new Address(_addr).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
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
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "execute_proposal",
                            args: [
                                new Address(_addr).toScVal(),
                                nativeToScVal(BigInt(proposalId), { type: "u64" }),
                            ],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            if (response.status !== "PENDING") throwSimulationError(undefined, "Transaction submission failed");
            return response.hash;
        } catch (e: unknown) {
            throw parseError(e);
        } finally {
            setLoading(false);
        }
    };

    const addSigner = async (signer: string) => {
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "add_signer",
                            args: [new Address(_addr).toScVal(), new Address(signer).toScVal()],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
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
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "remove_signer",
                            args: [new Address(_addr).toScVal(), new Address(signer).toScVal()],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
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
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "update_threshold",
                            args: [new Address(_addr).toScVal(), nativeToScVal(BigInt(newThreshold), { type: "u32" })],
                        })
                    ),
                    auth: [],
                }))
                .build();
            const simulation = await server.simulateTransaction(tx);
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
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
        const _addr = assertReady();
        setLoading(true);
        try {
            const account = await server.getAccount(_addr);
            const tx = new TransactionBuilder(account, { fee: "100" })
                .setNetworkPassphrase(env.networkPassphrase)
                .setTimeout(30)
                .addOperation(Operation.invokeHostFunction({
                    func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                        new xdr.InvokeContractArgs({
                            contractAddress: Address.fromString(env.contractId).toScAddress(),
                            functionName: "update_limits",
                            args: [
                                new Address(_addr).toScVal(),
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
            if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
            const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
            const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
            const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
            if (response.status !== "PENDING") throwSimulationError(undefined, "Transaction submission failed");
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

interface GetEventsParams {
    filters: Array<{ type: string; contractIds: string[] }>;
    pagination: { limit: number };
}

            const params: GetEventsParams = {
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
                const topicFingerprint =
                    ev.topic && ev.topic.length > 0 ? ev.topic.join('\x1e') : '';
                const payloadDigest = valueXdr ? eventPayloadDigest(valueXdr) : '';
                return {
                    id: ev.id,
                    type: eventType,
                    timestamp: ev.ledgerClosedAt || new Date().toISOString(),
                    ledger: ev.ledger,
                    actor,
                    details: { ...details, ledger: ev.ledger },
                    eventId: ev.id,
                    pagingToken: ev.pagingToken,
                    contractId: ev.contractId ?? env.contractId,
                    topicFingerprint,
                    payloadDigest,
                    callSucceeded: typeof ev.inSuccessfulContractCall === 'boolean' ? ev.inSuccessfulContractCall : undefined,
                };
            });

            return { activities, latestLedger: data.result?.latestLedger ?? latestLedger, cursor: resultCursor, hasMore };
        } catch (e) {
            console.error('getVaultEvents', e);
            return { activities: [], latestLedger: '0', hasMore: false };
        }
    };

    /**
     * Paginate Soroban getEvents until exhausted or maxEvents reached.
     * Used for audit log integrity over the full fetched history (not just the first page).
     */
    const getAllVaultEventsForAudit = async (maxEvents: number = 2000): Promise<GetVaultEventsResult> => {
        const aggregated: VaultActivity[] = [];
        let cursor: string | undefined;
        let latestLedger = '0';
        const pageLimit = 200;
        while (aggregated.length < maxEvents) {
            const page = await getVaultEvents(cursor, Math.min(pageLimit, maxEvents - aggregated.length));
            latestLedger = page.latestLedger;
            aggregated.push(...page.activities);
            if (!page.hasMore || !page.cursor) break;
            cursor = page.cursor;
            if (page.activities.length === 0) break;
        }
        return { activities: aggregated, latestLedger, hasMore: false };
    };

    const simulateTransaction = async (
        functionName: string,
        args: xdr.ScVal[],
        params?: GetEventsParams
    ): Promise<SimulationResult> => {
        if (!address) throw new Error("Wallet not connected");

        const serializedArgs = args.map((arg) => arg.toXDR('base64'));
        const cacheKey = generateCacheKey(functionName, [...serializedArgs, address]);
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
        try {
// Get the full signer list from vault config
const [configPrimary, configLegacy] = await Promise.all([
    readContractValue('get_config').catch(() => null),
    readContractValue('get_vault_config').catch(() => null),
]);
const configRaw = configPrimary ?? configLegacy;
const configObject = (configRaw && typeof configRaw === 'object') ? configRaw as VaultConfig : {};
const allSigners = parseSignerAddresses(configObject.signers);

// Fetch events to find approvals for this specific proposal
const latestRes = await fetch(env.sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
});
const latestData = await latestRes.json() as { result?: { sequence?: number } };
const latestLedger = latestData?.result?.sequence ?? 0;
const startLedger = Math.max(1, latestLedger - 50000);
const evRes = await fetch(env.sorobanRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        jsonrpc: '2.0', id: 2, method: 'getEvents',
        params: {
            startLedger: String(startLedger),
            filters: [{ type: 'contract', contractIds: [env.contractId] }],
            pagination: { limit: 200 },
        },
    }),
});
const evData = await evRes.json() as { result?: { events?: RawEvent[] } };
const events: RawEvent[] = evData.result?.events ?? [];

// Collect approvals for this proposal id
const approvalMap = new Map<string, string>(); // address -> timestamp
const proposalIdStr = String(proposalId);
for (const ev of events) {
    const topic0 = ev.topic?.[0];
    if (!topic0) continue;
    const evType = getEventTypeFromTopic(topic0);
    if (evType !== 'proposal_approved') continue;
    const evId = String(ev.id.split('-')[0] ?? ev.id);
    if (evId !== proposalIdStr) continue;
    const valueXdr = ev.value?.xdr;
    if (!valueXdr) continue;
    const { actor } = parseEventValue(valueXdr, evType);
    if (actor) approvalMap.set(actor, ev.ledgerClosedAt ?? new Date().toISOString());
}

// Build signer list: known signers first, then any approvers not in config
const signerSet = new Set(allSigners);
for (const addr of approvalMap.keys()) {
    if (!signerSet.has(addr)) allSigners.push(addr);
}

return allSigners.map(addr => ({
    address: addr,
    signed: approvalMap.has(addr),
    timestamp: approvalMap.get(addr),
}));
} catch (e) {
    console.error('getProposalSignatures failed:', e);
    return [];
}
}, [readContractValue]);

const remindSigner = useCallback(async (_proposalId: number, signerAddress: string) => {
    const url = `${window.location.origin}/dashboard/proposals?signer=${encodeURIComponent(signerAddress)}`;
    try {
        await navigator.clipboard.writeText(url);
    } catch {
        // fallback: no-op if clipboard unavailable
    }
}, []);

const exportSignatures = useCallback(async (proposalId: number) => {
    try {
        const sigs = await getProposalSignatures(proposalId);
        const blob = new Blob(
            [JSON.stringify({ proposalId, exportedAt: new Date().toISOString(), signatures: sigs }, null, 2)],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `proposal-${proposalId}-signatures.json`;
        a.click();
        URL.revokeObjectURL(url);
    } catch (e) {
        console.error('exportSignatures failed:', e);
    }
}, [getProposalSignatures]);


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
    const addToWhitelist = useCallback(async (recipient: string): Promise<void> => {
        const normalized = normalizeRecipientAddress(recipient);
        if (!normalized) return;
        setWhitelistAddresses((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    }, []);
    const removeFromWhitelist = useCallback(async (recipient: string): Promise<void> => {
        const normalized = normalizeRecipientAddress(recipient);
        setWhitelistAddresses((prev) => prev.filter((a) => a !== normalized));
    }, []);
    const addToBlacklist = useCallback(async (recipient: string): Promise<void> => {
        const normalized = normalizeRecipientAddress(recipient);
        if (!normalized) return;
        setBlacklistAddresses((prev) => (prev.includes(normalized) ? prev : [...prev, normalized]));
    }, []);
    const removeFromBlacklist = useCallback(async (recipient: string): Promise<void> => {
        const normalized = normalizeRecipientAddress(recipient);
        setBlacklistAddresses((prev) => prev.filter((a) => a !== normalized));
    }, []);
    const isWhitelisted = useCallback(async (recipient: string): Promise<boolean> => whitelistAddresses.includes(recipient), [whitelistAddresses]);
    const isBlacklisted = useCallback(async (recipient: string): Promise<boolean> => blacklistAddresses.includes(recipient), [blacklistAddresses]);
    const getWhitelistAddresses = useCallback(async (): Promise<string[]> => [...whitelistAddresses], [whitelistAddresses]);
    const getBlacklistAddresses = useCallback(async (): Promise<string[]> => [...blacklistAddresses], [blacklistAddresses]);

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
                const d = ev.details as ProposalEventData;
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
                const d = ev.details as ProposalEventData;
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
        getDashboardStats, getVaultEvents, getAllVaultEventsForAudit, loading,
        simulateProposeTransfer, simulateApproveProposal, simulateExecuteProposal, simulateRejectProposal,
        getProposalSignatures, remindSigner, exportSignatures,
        addComment, editComment, getProposalComments,
        getListMode, setListMode,
        addToWhitelist, removeFromWhitelist, addToBlacklist, removeFromBlacklist,
        isWhitelisted, isBlacklisted, getWhitelistAddresses, getBlacklistAddresses,
        getVaultConfig,
        getTokenBalances,
        getPortfolioValue,
        addCustomToken,
        getVaultBalance,
        getRecurringPayments: async (): Promise<RecurringPayment[]> => {
            // Probe recurring payment IDs 1..N from contract storage.
            // Also merge any locally-cancelled IDs from localStorage.
            const cancelledKey = `vault_cancelled_recurring_${env.contractId}`;
            let cancelledIds: string[] = [];
            try { cancelledIds = JSON.parse(localStorage.getItem(cancelledKey) ?? '[]'); } catch { /* ignore */ }
            const cancelledSet = new Set(cancelledIds);

            const payments: RecurringPayment[] = [];
            const LEDGER_INTERVAL_S = 5;
            const now = Date.now();

            // Fetch the next recurring ID to know the upper bound
            let maxId = 0;
            try {
                const nextId = await readContractValue('get_next_recurring_id').catch(() => null);
                maxId = nextId != null ? Math.max(0, parseNumericValue(nextId) - 1) : 0;
            } catch { /* ignore */ }

            // Fetch each payment by ID (up to 50 to avoid excessive calls)
            const ids = Array.from({ length: Math.min(maxId, 50) }, (_, i) => i + 1);
            const results = await Promise.allSettled(
                ids.map(id => readContractValue('get_recurring_payment', [nativeToScVal(BigInt(id), { type: 'u64' })]))
            );

            // Get current ledger for time estimation
            let currentLedger = 0;
            try {
                const latestRes = await fetch(env.sorobanRpcUrl, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
                });
                const latestData = await latestRes.json() as { result?: { sequence?: number } };
                currentLedger = latestData?.result?.sequence ?? 0;
            } catch { /* ignore */ }

interface RecurringPaymentRaw {
    is_active?: boolean;
    isActive?: boolean;
    [key: string]: unknown;
}

            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (r.status !== 'fulfilled' || r.value == null) continue;
                const raw = r.value as RecurringPaymentRaw;
                const id = String(ids[i]);
                const isActive = Boolean(raw.is_active ?? raw.isActive ?? true);
                const isCancelled = cancelledSet.has(id);
                const intervalLedgers = parseNumericValue(raw.interval);
                const intervalSeconds = intervalLedgers * LEDGER_INTERVAL_S;
                const nextLedger = parseNumericValue(raw.next_payment_ledger ?? raw.nextPaymentLedger);
                const ledgersUntilNext = Math.max(0, nextLedger - currentLedger);
                const nextPaymentTime = now + ledgersUntilNext * LEDGER_INTERVAL_S * 1000;

                payments.push({
                    id,
                    recipient: addressToNative(raw.recipient),
                    token: addressToNative(raw.token),
                    amount: parseBigIntString(raw.amount),
                    memo: typeof raw.memo === 'string' ? raw.memo : '',
                    interval: intervalSeconds,
                    nextPaymentTime,
                    totalPayments: parseNumericValue(raw.payment_count ?? raw.paymentCount),
                    status: isCancelled ? 'cancelled' : isActive ? 'active' : 'cancelled',
                    createdAt: now,
                    creator: addressToNative(raw.proposer),
                });
            }
            return payments;
        },
        getRecurringPaymentHistory: async (paymentId?: string): Promise<RecurringPaymentHistory[]> => {
            // Fetch payment_executed events and filter by payment context.
            // The contract doesn't emit a specific recurring event, so we return
            // locally-stored execution records if available.
            const historyKey = `vault_recurring_history_${env.contractId}_${paymentId ?? 'all'}`;
            try {
                const stored = localStorage.getItem(historyKey);
                if (stored) return JSON.parse(stored) as RecurringPaymentHistory[];
            } catch { /* ignore */ }
            return [];
        },
        schedulePayment: async (params?: CreateRecurringPaymentParams): Promise<string> => {
            const _addr = assertReady();
            if (!params) throw new Error('Payment parameters required');
            setLoading(true);
            try {
                const account = await server.getAccount(_addr);
                // Convert seconds to ledgers (~5s per ledger), minimum 720 ledgers (1 hour)
                const LEDGER_INTERVAL_S = 5;
                const intervalLedgers = Math.max(720, Math.round(params.interval / LEDGER_INTERVAL_S));
                const tokenAddress = params.token === 'native'
                    ? 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC' // XLM SAC on testnet
                    : params.token;
                const tx = new TransactionBuilder(account, { fee: '100' })
                    .setNetworkPassphrase(env.networkPassphrase)
                    .setTimeout(30)
                    .addOperation(Operation.invokeHostFunction({
                        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                            new xdr.InvokeContractArgs({
                                contractAddress: Address.fromString(env.contractId).toScAddress(),
                                functionName: 'schedule_payment',
                                args: [
                                    new Address(_addr).toScVal(),
                                    new Address(params.recipient).toScVal(),
                                    new Address(tokenAddress).toScVal(),
                                    nativeToScVal(BigInt(params.amount), { type: 'i128' }),
                                    xdr.ScVal.scvSymbol(params.memo || 'recurring'),
                                    nativeToScVal(BigInt(intervalLedgers), { type: 'u64' }),
                                ],
                            })
                        ),
                        auth: [],
                    }))
                    .build();
                const simulation = await server.simulateTransaction(tx);
                if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
                const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
                const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
                const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
                return response.hash;
            } catch (e: unknown) {
                throw parseError(e);
            } finally {
                setLoading(false);
            }
        },
        executeRecurringPayment: async (paymentId?: string): Promise<void> => {
            const _addr = assertReady();
            if (!paymentId) throw new Error('Payment ID required');
            setLoading(true);
            try {
                const account = await server.getAccount(_addr);
                const tx = new TransactionBuilder(account, { fee: '100' })
                    .setNetworkPassphrase(env.networkPassphrase)
                    .setTimeout(30)
                    .addOperation(Operation.invokeHostFunction({
                        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                            new xdr.InvokeContractArgs({
                                contractAddress: Address.fromString(env.contractId).toScAddress(),
                                functionName: 'execute_recurring_payment',
                                args: [nativeToScVal(BigInt(paymentId), { type: 'u64' })],
                            })
                        ),
                        auth: [],
                    }))
                    .build();
                const simulation = await server.simulateTransaction(tx);
                if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
                const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
                const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
                const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
                // Record execution in localStorage history
                const historyKey = `vault_recurring_history_${env.contractId}_${paymentId}`;
                try {
                    const existing: RecurringPaymentHistory[] = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
                    existing.unshift({
                        id: `${paymentId}-${Date.now()}`,
                        paymentId,
                        executedAt: Date.now(),
                        transactionHash: response.hash,
                        amount: '0',
                        success: true,
                    });
                    localStorage.setItem(historyKey, JSON.stringify(existing.slice(0, 50)));
                } catch { /* ignore */ }
            } catch (e: unknown) {
                throw parseError(e);
            } finally {
                setLoading(false);
            }
        },
        cancelRecurringPayment: async (paymentId?: string): Promise<void> => {
            // No cancel function exists on-chain; persist cancellation locally.
            if (!paymentId) throw new Error('Payment ID required');
            const cancelledKey = `vault_cancelled_recurring_${env.contractId}`;
            try {
                const existing: string[] = JSON.parse(localStorage.getItem(cancelledKey) ?? '[]');
                if (!existing.includes(paymentId)) {
                    existing.push(paymentId);
                    localStorage.setItem(cancelledKey, JSON.stringify(existing));
                }
            } catch { /* ignore */ }
        },
        getAllRoles: async (): Promise<RoleAssignment[]> => {
            const result = await readContractValue('get_role_assignments');
            return parseRoleAssignments(result);
        },
        setRole: async (targetAddress: string, nextRole: number): Promise<string> => {
            const _addr = assertReady();
            const normalizedAddress = targetAddress.trim();
            if (!isValidStellarAddress(normalizedAddress)) {
                throw new Error('Invalid Stellar address');
            }
            if (![0, 1, 2].includes(nextRole)) {
                throw new Error('Invalid role selected');
            }

            setLoading(true);
            try {
                const account = await server.getAccount(_addr);
                const tx = new TransactionBuilder(account, { fee: "100" })
                    .setNetworkPassphrase(env.networkPassphrase)
                    .setTimeout(30)
                    .addOperation(Operation.invokeHostFunction({
                        func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                            new xdr.InvokeContractArgs({
                                contractAddress: Address.fromString(env.contractId).toScAddress(),
                                functionName: "set_role",
                                args: [
                                    new Address(_addr).toScVal(),
                                    new Address(normalizedAddress).toScVal(),
                                    nativeToScVal(BigInt(nextRole), { type: "u32" }),
                                ],
                            })
                        ),
                        auth: [],
                    }))
                    .build();
                const simulation = await server.simulateTransaction(tx);
                if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
                const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
                const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
                const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
                return response.hash;
            } catch (e: unknown) {
                throw parseError(e);
            } finally {
                setLoading(false);
            }
        },
        getUserRole,
        assignRole: async (targetAddress: string, nextRole: number): Promise<string> => {
            return await (async () => {
                const _addr = assertReady();
                const normalizedAddress = targetAddress.trim();
                if (!isValidStellarAddress(normalizedAddress)) {
                    throw new Error('Invalid Stellar address');
                }
                if (![0, 1, 2].includes(nextRole)) {
                    throw new Error('Invalid role selected');
                }

                setLoading(true);
                try {
                    const account = await server.getAccount(_addr);
                    const tx = new TransactionBuilder(account, { fee: "100" })
                        .setNetworkPassphrase(env.networkPassphrase)
                        .setTimeout(30)
                        .addOperation(Operation.invokeHostFunction({
                            func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                                new xdr.InvokeContractArgs({
                                    contractAddress: Address.fromString(env.contractId).toScAddress(),
                                    functionName: "set_role",
                                    args: [
                                        new Address(_addr).toScVal(),
                                        new Address(normalizedAddress).toScVal(),
                                        nativeToScVal(BigInt(nextRole), { type: "u32" }),
                                    ],
                                })
                            ),
                            auth: [],
                        }))
                        .build();
                    const simulation = await server.simulateTransaction(tx);
                    if (SorobanRpc.Api.isSimulationError(simulation)) throwSimulationError(simulation.error, "Simulation failed");
                    const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
                    const signedXdr = await signTransaction(preparedTx.toXDR(), { network: env.stellarNetwork });
                    const response = await server.sendTransaction(TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase));
                    return response.hash;
                } catch (e: unknown) {
                    throw parseError(e);
                } finally {
                    setLoading(false);
                }
            })();
        },
        updateSpendingLimits,
        getProposals,
        assertReady,
    };
};
