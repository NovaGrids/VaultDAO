import { SorobanRpc } from 'stellar-sdk';

export interface SimulationResult {
    success: boolean;
    fee: string;
    feeXLM: string;
    resourceFee: string;
    error?: string;
    errorCode?: string;
    stateChanges?: StateChange[];
    timestamp: number;
}

export interface StateChange {
    type: 'balance' | 'proposal' | 'approval' | 'config' | 'role';
    description: string;
    before?: string;
    after?: string;
}

export interface SimulationCache {
    [key: string]: SimulationResult;
}

const CACHE_DURATION = 30000; // 30 seconds
const simulationCache: SimulationCache = {};

/**
 * Generate cache key from transaction parameters
 */
export function generateCacheKey(params: Record<string, unknown>): string {
    return JSON.stringify(params);
}

/**
 * Get cached simulation result if still valid
 */
export function getCachedSimulation(cacheKey: string): SimulationResult | null {
    const cached = simulationCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return cached;
    }
    return null;
}

/**
 * Cache simulation result
 */
export function cacheSimulation(cacheKey: string, result: SimulationResult): void {
    simulationCache[cacheKey] = {
        ...result,
        timestamp: Date.now(),
    };
}

/**
 * Clear expired cache entries
 */
export function clearExpiredCache(): void {
    const now = Date.now();
    Object.keys(simulationCache).forEach((key) => {
        if (now - simulationCache[key].timestamp >= CACHE_DURATION) {
            delete simulationCache[key];
        }
    });
}

/**
 * Convert stroops to XLM
 */
export function stroopsToXLM(stroops: string | number): string {
    const amount = typeof stroops === 'string' ? parseInt(stroops, 10) : stroops;
    return (amount / 10000000).toFixed(7);
}

/**
 * Parse simulation error and provide user-friendly message
 */
export function parseSimulationError(error: unknown): { message: string; code?: string; suggestion?: string } {
    if (typeof error === 'string') {
        return { message: error };
    }

    // Handle Soroban RPC simulation errors
    if (error && typeof error === 'object' && 'error' in error) {
        const errorMsg = String((error as { error: unknown }).error || '');

        // Common error patterns
        if (errorMsg.includes('insufficient')) {
            return {
                message: 'Insufficient balance',
                code: 'INSUFFICIENT_BALANCE',
                suggestion: 'Ensure the vault has enough funds to cover this transaction and fees.',
            };
        }

        if (errorMsg.includes('unauthorized') || errorMsg.includes('auth')) {
            return {
                message: 'Authorization required',
                code: 'UNAUTHORIZED',
                suggestion: 'Make sure you have the required permissions for this action.',
            };
        }

        if (errorMsg.includes('threshold')) {
            return {
                message: 'Approval threshold not met',
                code: 'THRESHOLD_NOT_MET',
                suggestion: 'This proposal needs more approvals before it can be executed.',
            };
        }

        if (errorMsg.includes('timelock')) {
            return {
                message: 'Timelock period not expired',
                code: 'TIMELOCK_ACTIVE',
                suggestion: 'Wait for the timelock period to expire before executing.',
            };
        }

        if (errorMsg.includes('expired')) {
            return {
                message: 'Proposal has expired',
                code: 'PROPOSAL_EXPIRED',
                suggestion: 'This proposal can no longer be executed.',
            };
        }

        if (errorMsg.includes('whitelist')) {
            return {
                message: 'Recipient not on whitelist',
                code: 'NOT_WHITELISTED',
                suggestion: 'Add the recipient to the whitelist before creating this proposal.',
            };
        }

        if (errorMsg.includes('blacklist')) {
            return {
                message: 'Recipient is blacklisted',
                code: 'BLACKLISTED',
                suggestion: 'This recipient cannot receive funds due to blacklist restrictions.',
            };
        }

        return { message: errorMsg };
    }

    return { message: error instanceof Error ? error.message : "Simulation failed" };
}

/**
 * Extract state changes from simulation result
 */
export function extractStateChanges(
    simulation: SorobanRpc.Api.SimulateTransactionResponse,
    actionType: string,
    params?: Record<string, unknown>
): StateChange[] {
    const changes: StateChange[] = [];

    if (!SorobanRpc.Api.isSimulationSuccess(simulation)) {
        return changes;
    }

    // Based on action type, predict state changes
    switch (actionType) {
        case 'propose_transfer':
            if (params?.amount && params?.recipient) {
                changes.push({
                    type: 'proposal',
                    description: 'New proposal created',
                    after: `Transfer ${stroopsToXLM(String(params.amount || ""))} XLM to ${String(params.recipient || "").slice(0, 8)}...`,
                });
                changes.push({
                    type: 'balance',
                    description: 'Daily spending limit',
                    before: 'Current usage',
                    after: `+${stroopsToXLM(String(params.amount || ""))} XLM`,
                });
            }
            break;

        case 'approve_proposal':
            changes.push({
                type: 'approval',
                description: 'Approval added',
                after: 'Your approval will be recorded',
            });
            changes.push({
                type: 'proposal',
                description: 'Proposal status may change',
                after: 'May become "Approved" if threshold is met',
            });
            break;

        case 'execute_proposal':
            if (params?.amount && params?.recipient) {
                changes.push({
                    type: 'balance',
                    description: 'Vault balance',
                    after: `-${stroopsToXLM(String(params.amount || ""))} XLM`,
                });
                changes.push({
                    type: 'proposal',
                    description: 'Proposal status',
                    before: 'Approved',
                    after: 'Executed',
                });
            }
            break;

        case 'reject_proposal':
            changes.push({
                type: 'proposal',
                description: 'Proposal status',
                before: 'Pending',
                after: 'Rejected',
            });
            break;

        case 'set_role':
            if (params?.role) {
                changes.push({
                    type: 'role',
                    description: 'User role updated',
                    after: `Role: ${params.role}`,
                });
            }
            break;

        case 'add_signer':
            changes.push({
                type: 'config',
                description: 'Signer added',
                after: 'Total signers increased by 1',
            });
            break;

        case 'remove_signer':
            changes.push({
                type: 'config',
                description: 'Signer removed',
                after: 'Total signers decreased by 1',
            });
            break;
    }

    return changes;
}

/**
 * Format fee breakdown
 */
export function formatFeeBreakdown(simulation: SorobanRpc.Api.SimulateTransactionSuccessResponse): {
    baseFee: string;
    resourceFee: string;
    totalFee: string;
    totalFeeXLM: string;
} {
    // Extract fees from simulation
    const minResourceFee = simulation.minResourceFee || '0';
    const baseFee = '100'; // Standard Stellar base fee in stroops
    const totalFee = (parseInt(baseFee, 10) + parseInt(minResourceFee, 10)).toString();

    return {
        baseFee: stroopsToXLM(baseFee),
        resourceFee: stroopsToXLM(minResourceFee),
        totalFee: stroopsToXLM(totalFee),
        totalFeeXLM: stroopsToXLM(totalFee),
    };
}

/**
 * Check if error is a warning (can proceed) or critical error
 */
export function isWarning(errorCode?: string): boolean {
    const warningCodes = ['TIMELOCK_ACTIVE', 'THRESHOLD_NOT_MET'];
    return errorCode ? warningCodes.includes(errorCode) : false;
}
