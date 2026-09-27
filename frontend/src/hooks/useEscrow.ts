/**
 * useEscrow — hook for fetching and managing escrow agreements.
 *
 * Escrows are loaded directly from the contract: the connected wallet's IDs
 * come from `get_funder_escrows` / `get_recipient_escrows`, and each record is
 * read with `get_escrow_info`. Mock data is only served when `env.demoMode`
 * is enabled.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  xdr,
  Address,
  Operation,
  TransactionBuilder,
  SorobanRpc,
  nativeToScVal,
} from 'stellar-sdk';
import { useWallet } from './useWallet';
import { env } from '../config/env';
import { parseError } from '../utils/errorParser';
import { readContract, fetchLatestLedger } from '../utils/contractRead';
import { newTransactionBuilder } from '../utils/transactionBuilder';
import { fetchContractEvents, isAbortError } from '../utils/sorobanEvents';
import type { Escrow, EscrowStatus, Milestone, MilestoneStatus, EscrowDispute } from '../types/escrow';

const server = new SorobanRpc.Server(env.sorobanRpcUrl);

// ─── helpers ─────────────────────────────────────────────────────────────────

function truncateAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Approximate seconds per ledger on Stellar, used to date ledger numbers. */
const SECONDS_PER_LEDGER = 5;

/** Contract `EscrowStatus` enum values. */
const CONTRACT_ESCROW_STATUS = {
  Pending: 0,
  Active: 1,
  MilestonesComplete: 2,
  Released: 3,
  Refunded: 4,
  Disputed: 5,
} as const;

/** Shape of `Escrow` as returned by `get_escrow_info` after scValToNative. */
export interface ContractEscrow {
  id: bigint | number;
  funder: string;
  recipient: string;
  token: string;
  total_amount: bigint | number;
  released_amount: bigint | number;
  milestones: Array<{
    id: bigint | number;
    percentage: number;
    release_ledger: bigint | number;
    is_completed: boolean;
    completion_ledger: bigint | number;
  }>;
  status: number;
  arbitrator: string;
  dispute_reason: string;
  created_at: bigint | number;
  expires_at: bigint | number;
  finalized_at: bigint | number;
}

function toBigInt(v: unknown): bigint {
  if (typeof v === 'bigint') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v));
  if (typeof v === 'string' && /^-?\d+$/.test(v)) return BigInt(v);
  return 0n;
}

function toIdList(v: unknown): bigint[] {
  return Array.isArray(v) ? v.map(toBigInt) : [];
}

/** Map an on-chain escrow record to the frontend Escrow shape. */
export function mapContractEscrow(raw: ContractEscrow, latestLedger: number, nowMs = Date.now()): Escrow {
  const total = toBigInt(raw.total_amount);
  const createdLedger = Number(toBigInt(raw.created_at));
  const expiresLedger = Number(toBigInt(raw.expires_at));
  const finalized = toBigInt(raw.finalized_at) > 0n;
  const disputeReason = typeof raw.dispute_reason === 'string' ? raw.dispute_reason : '';

  let status: EscrowStatus;
  switch (Number(raw.status)) {
    case CONTRACT_ESCROW_STATUS.Released:
      status = 'released';
      break;
    case CONTRACT_ESCROW_STATUS.Disputed:
      status = 'disputed';
      break;
    case CONTRACT_ESCROW_STATUS.Refunded:
      status = disputeReason ? 'resolved' : 'expired';
      break;
    default:
      status = !finalized && latestLedger > 0 && latestLedger > expiresLedger ? 'expired' : 'active';
  }

  const milestones: Milestone[] = (raw.milestones ?? []).map((m, index) => {
    const pct = Number(m.percentage) || 0;
    const milestoneStatus: MilestoneStatus = m.is_completed ? 'verified' : 'pending';
    return {
      index,
      description: `Milestone ${index + 1} (${pct}%)`,
      requiredVerifiers: 1,
      verifications: [],
      status: milestoneStatus,
      amount: ((total * BigInt(pct)) / 100n).toString(),
    };
  });

  let dispute: EscrowDispute = { status: 'none' };
  if (Number(raw.status) === CONTRACT_ESCROW_STATUS.Disputed) {
    dispute = { status: 'open', reason: disputeReason || undefined };
  } else if (disputeReason) {
    dispute = {
      status: 'resolved',
      reason: disputeReason,
      releasedToRecipient: Number(raw.status) === CONTRACT_ESCROW_STATUS.Released,
    };
  }

  const ageSeconds = latestLedger > 0 ? Math.max(0, latestLedger - createdLedger) * SECONDS_PER_LEDGER : 0;

  return {
    id: toBigInt(raw.id).toString(),
    funder: String(raw.funder),
    recipient: String(raw.recipient),
    token: String(raw.token),
    amount: total.toString(),
    releasedAmount: toBigInt(raw.released_amount).toString(),
    arbitrator: String(raw.arbitrator),
    durationLedgers: Math.max(0, expiresLedger - createdLedger),
    createdAt: new Date(nowMs - ageSeconds * 1000).toISOString(),
    status,
    milestones,
    dispute,
  };
}

/** Build a mock escrow list (demo mode only). */
function buildMockEscrows(walletAddress: string | null): Escrow[] {
  const addr = walletAddress ?? 'GABC...1234';
  return [
    {
      id: '1',
      funder: addr,
      recipient: 'GBOB...5678',
      token: 'XLM',
      amount: '50000000000', // 5000 XLM in stroops
      releasedAmount: '10000000000',
      arbitrator: 'GARB...9999',
      durationLedgers: 172800,
      createdAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
      milestones: [
        {
          index: 0,
          description: 'Initial design deliverable',
          requiredVerifiers: 2,
          verifications: ['GSIG...0001'],
          status: 'verified',
          amount: '10000000000',
        },
        {
          index: 1,
          description: 'Smart contract implementation',
          requiredVerifiers: 3,
          verifications: ['GSIG...0001', 'GSIG...0002'],
          status: 'submitted',
          amount: '20000000000',
        },
        {
          index: 2,
          description: 'Final audit and deployment',
          requiredVerifiers: 3,
          verifications: [],
          status: 'pending',
          amount: '20000000000',
        },
      ],
      dispute: { status: 'none' },
    },
    {
      id: '2',
      funder: 'GFUN...1111',
      recipient: addr,
      token: 'XLM',
      amount: '20000000000',
      releasedAmount: '0',
      arbitrator: 'GARB...9999',
      durationLedgers: 86400,
      createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'disputed',
      milestones: [
        {
          index: 0,
          description: 'Frontend prototype',
          requiredVerifiers: 2,
          verifications: ['GSIG...0001'],
          status: 'submitted',
          amount: '20000000000',
        },
      ],
      dispute: {
        status: 'open',
        disputer: 'GFUN...1111',
        reason: 'Deliverable does not meet specifications',
      },
    },
  ];
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export interface UseEscrowReturn {
  escrows: Escrow[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  verifyMilestone: (escrowId: string, milestoneIndex: number) => Promise<string>;
  raiseDispute: (escrowId: string, reason: string) => Promise<string>;
  verifyingMilestone: string | null; // `${escrowId}-${milestoneIndex}`
  raisingDispute: string | null; // escrowId
}

export function useEscrow(): UseEscrowReturn {
  const { address, isConnected, network, signTransaction } = useWallet();

  const [escrows, setEscrows] = useState<Escrow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifyingMilestone, setVerifyingMilestone] = useState<string | null>(null);
  const [raisingDispute, setRaisingDispute] = useState<string | null>(null);

  const assertReady = useCallback((): string => {
    if (!isConnected || !address) {
      throw { code: 'WALLET_NOT_CONNECTED', message: 'Please connect your wallet.' };
    }
    if (network && network.toUpperCase() !== env.stellarNetwork.toUpperCase()) {
      throw { code: 'NETWORK_MISMATCH', message: `Please switch to ${env.stellarNetwork}.` };
    }
    return address;
  }, [isConnected, address, network]);

  /**
   * Load escrows where the connected wallet is funder or recipient.
   * Mock data is only used in demo mode; otherwise an empty list is returned
   * when the wallet has no escrows and failures surface through `error`.
   */
  const fetchAbortRef = useRef<AbortController | null>(null);

  const fetchEscrows = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    setError(null);
    if (env.demoMode) {
      setEscrows(buildMockEscrows(address));
      setLoading(false);
      return;
    }
    if (!address) {
      setEscrows([]);
      setLoading(false);
      return;
    }
    try {
      const walletArg = [new Address(address).toScVal()];
      const [funderIds, recipientIds, latestLedger] = await Promise.all([
        readContract('get_funder_escrows', walletArg, address),
        readContract('get_recipient_escrows', walletArg, address),
        fetchLatestLedger().catch(() => 0),
      ]);

      const ids = Array.from(
        new Set([...toIdList(funderIds), ...toIdList(recipientIds)].map((id) => id.toString())),
      ).sort((a, b) => (BigInt(b) > BigInt(a) ? 1 : BigInt(b) < BigInt(a) ? -1 : 0));

      const results = await Promise.allSettled(
        ids.map((id) =>
          readContract('get_escrow_info', [nativeToScVal(BigInt(id), { type: 'u64' })], address),
        ),
      );

      const loaded: Escrow[] = [];
      results.forEach((r, i) => {
        if (r.status === 'fulfilled' && r.value) {
          loaded.push(mapContractEscrow(r.value as ContractEscrow, latestLedger));
        } else if (r.status === 'rejected') {
          console.warn(`useEscrow: failed to load escrow ${ids[i]}`, r.reason);
      // Attempt to fetch from Soroban events
      const { events } = await fetchContractEvents({
        lookbackLedgers: 100_000,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      // Filter escrow-related events
      const escrowEvents = events.filter((ev) => {
        const topic0 = ev.topic?.[0];
        if (!topic0) return false;
        try {
          const { scValToNative } = require('stellar-sdk');
          const scv = xdr.ScVal.fromXDR(topic0, 'base64');
          const native = scValToNative(scv);
          return typeof native === 'string' && native.startsWith('escrow');
        } catch {
          return false;
        }
      });

      setEscrows(loaded);
      if (ids.length > 0 && loaded.length === 0) {
        setError('Failed to load escrow details');
      }
    } catch (err) {
      if (isAbortError(err) || controller.signal.aborted) return;
      console.error('useEscrow: fetchEscrows failed', err);
      setEscrows([]);
      setError(err instanceof Error ? err.message : 'Failed to load escrows');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void fetchEscrows();
  }, [fetchEscrows]);

  // Cancel any in-flight event fetch on unmount
  useEffect(() => () => fetchAbortRef.current?.abort(), []);

  /**
   * Call the contract's verify_milestone function.
   * Matches the requirement: useVaultContract.verifyMilestone(roundId, milestoneIndex)
   */
  const verifyMilestone = useCallback(
    async (escrowId: string, milestoneIndex: number): Promise<string> => {
      const _addr = assertReady();
      const key = `${escrowId}-${milestoneIndex}`;
      setVerifyingMilestone(key);
      try {
        const account = await server.getAccount(_addr);
        const tx = (await newTransactionBuilder(account))
          .addOperation(
            Operation.invokeHostFunction({
              func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                new xdr.InvokeContractArgs({
                  contractAddress: Address.fromString(env.contractId).toScAddress(),
                  functionName: 'verify_milestone',
                  args: [
                    new Address(_addr).toScVal(),
                    nativeToScVal(BigInt(escrowId), { type: 'u64' }),
                    nativeToScVal(milestoneIndex, { type: 'u32' }),
                  ],
                })
              ),
              auth: [],
            })
          )
          .build();

        const simulation = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(simulation)) {
          throw new Error(simulation.error ?? 'Simulation failed');
        }
        const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
        const signedXdr = await signTransaction(preparedTx.toXDR(), {
          network: env.stellarNetwork,
        });
        const response = await server.sendTransaction(
          TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase)
        );

        // Optimistically update local state
        setEscrows((prev) =>
          prev.map((e) => {
            if (e.id !== escrowId) return e;
            return {
              ...e,
              milestones: e.milestones.map((m) => {
                if (m.index !== milestoneIndex) return m;
                const newVerifications = m.verifications.includes(_addr)
                  ? m.verifications
                  : [...m.verifications, _addr];
                const newStatus: MilestoneStatus =
                  newVerifications.length >= m.requiredVerifiers ? 'verified' : m.status;
                return { ...m, verifications: newVerifications, status: newStatus };
              }),
            };
          })
        );

        return response.hash;
      } catch (e) {
        throw parseError(e);
      } finally {
        setVerifyingMilestone(null);
      }
    },
    [assertReady, signTransaction]
  );

  /**
   * Call the contract's dispute_escrow function.
   */
  const raiseDispute = useCallback(
    async (escrowId: string, reason: string): Promise<string> => {
      const _addr = assertReady();
      setRaisingDispute(escrowId);
      try {
        const account = await server.getAccount(_addr);
        const tx = (await newTransactionBuilder(account))
          .addOperation(
            Operation.invokeHostFunction({
              func: xdr.HostFunction.hostFunctionTypeInvokeContract(
                new xdr.InvokeContractArgs({
                  contractAddress: Address.fromString(env.contractId).toScAddress(),
                  functionName: 'dispute_escrow',
                  args: [
                    new Address(_addr).toScVal(),
                    nativeToScVal(BigInt(escrowId), { type: 'u64' }),
                    xdr.ScVal.scvString(reason),
                  ],
                })
              ),
              auth: [],
            })
          )
          .build();

        const simulation = await server.simulateTransaction(tx);
        if (SorobanRpc.Api.isSimulationError(simulation)) {
          throw new Error(simulation.error ?? 'Simulation failed');
        }
        const preparedTx = SorobanRpc.assembleTransaction(tx, simulation).build();
        const signedXdr = await signTransaction(preparedTx.toXDR(), {
          network: env.stellarNetwork,
        });
        const response = await server.sendTransaction(
          TransactionBuilder.fromXDR(signedXdr as string, env.networkPassphrase)
        );

        // Optimistically update local state
        setEscrows((prev) =>
          prev.map((e) => {
            if (e.id !== escrowId) return e;
            return {
              ...e,
              status: 'disputed' as EscrowStatus,
              dispute: {
                status: 'open',
                disputer: _addr,
                reason,
              },
            };
          })
        );

        return response.hash;
      } catch (e) {
        throw parseError(e);
      } finally {
        setRaisingDispute(null);
      }
    },
    [assertReady, signTransaction]
  );

  return {
    escrows,
    loading,
    error,
    refetch: fetchEscrows,
    verifyMilestone,
    raiseDispute,
    verifyingMilestone,
    raisingDispute,
  };
}

export { truncateAddr };
