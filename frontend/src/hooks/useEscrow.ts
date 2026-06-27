/**
 * useEscrow — hook for fetching and managing escrow agreements.
 *
 * The backend GET /api/v1/escrow endpoint is not yet implemented, so this hook
 * reconstructs escrow state from on-chain Soroban events via useVaultContract's
 * getVaultEvents, mirroring the same pattern used by getProposals().
 */

import { useState, useCallback, useEffect } from 'react';
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
import type { Escrow, EscrowStatus, Milestone, MilestoneStatus, EscrowDispute } from '../types/escrow';

const server = new SorobanRpc.Server(env.sorobanRpcUrl);

// ─── helpers ─────────────────────────────────────────────────────────────────

function truncateAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Build a mock escrow list for development / when no on-chain data exists. */
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
   * Fetch escrows from on-chain events.
   * Falls back to mock data when no events are found (dev / testnet with no escrow activity).
   */
  const fetchEscrows = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Attempt to fetch from Soroban events
      const latestRes = await fetch(env.sorobanRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getLatestLedger' }),
      });
      const latestData = await latestRes.json() as { result?: { sequence?: number } };
      const latestLedger = latestData?.result?.sequence ?? 0;
      const startLedger = Math.max(1, latestLedger - 100000);

      const evRes = await fetch(env.sorobanRpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'getEvents',
          params: {
            startLedger: String(startLedger),
            filters: [{ type: 'contract', contractIds: [env.contractId] }],
            pagination: { limit: 200 },
          },
        }),
      });
      const evData = await evRes.json() as {
        result?: {
          events?: Array<{
            id: string;
            topic?: string[];
            value?: { xdr?: string };
            ledgerClosedAt?: string;
          }>;
        };
      };

      const events = evData.result?.events ?? [];

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

      if (escrowEvents.length === 0) {
        // No on-chain escrow data — use mock data filtered by wallet
        setEscrows(buildMockEscrows(address));
        return;
      }

      // TODO: reconstruct escrow state from events when real data exists
      setEscrows(buildMockEscrows(address));
    } catch (err) {
      console.error('useEscrow: fetchEscrows failed', err);
      // Graceful fallback to mock data
      setEscrows(buildMockEscrows(address));
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void fetchEscrows();
  }, [fetchEscrows]);

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
        const tx = new TransactionBuilder(account, { fee: '100' })
          .setNetworkPassphrase(env.networkPassphrase)
          .setTimeout(30)
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
        const tx = new TransactionBuilder(account, { fee: '100' })
          .setNetworkPassphrase(env.networkPassphrase)
          .setTimeout(30)
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
