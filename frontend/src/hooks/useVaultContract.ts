// frontend/src/hooks/useVaultContract.ts

import { useCallback } from 'react';
import { useSorobanReact } from '@soroban-react/core';

// Define the Proposal type
export interface Proposal {
  id: number;
  proposer: string;
  recipient: string;
  amount: bigint;
  status: ProposalStatus;
  description: string;
  createdAt: number;
  unlockTime?: number;
}

export const ProposalStatus = {
  Pending: 0,
  Approved: 1,
  Executed: 2,
  Rejected: 3,
  Expired: 4,
} as const;

export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

type SorobanServer = NonNullable<ReturnType<typeof useSorobanReact>['server']>;
type ContractDataKey = Parameters<SorobanServer['getContractData']>[1];

const toObjectRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === 'object' && value !== null) {
    return value as Record<string, unknown>;
  }
  return {};
};

const unwrapVal = (value: unknown): unknown => {
  const record = toObjectRecord(value);
  return record.val ?? value;
};

const normalizeStatus = (value: unknown): ProposalStatus => {
  const parsed = Number(value);
  switch (parsed) {
    case ProposalStatus.Pending:
    case ProposalStatus.Approved:
    case ProposalStatus.Executed:
    case ProposalStatus.Rejected:
    case ProposalStatus.Expired:
      return parsed;
    default:
      return ProposalStatus.Pending;
  }
};

const toBigInt = (value: unknown): bigint => {
  try {
    return BigInt(String(value ?? 0));
  } catch {
    return 0n;
  }
};

const parseProposal = (id: number, rawValue: unknown): Proposal => {
  const value = toObjectRecord(unwrapVal(rawValue));

  const proposer = String(value.proposer ?? value.from ?? '');
  const recipient = String(value.recipient ?? value.to ?? '');
  const amount = toBigInt(value.amount ?? value.value);
  const status = normalizeStatus(value.status ?? value.state);
  const createdAt = Number(value.created_at ?? value.createdAt ?? 0);
  const unlockTime = value.unlock_ledger ?? value.unlockTime;
  const description = String(value.memo ?? value.description ?? '');

  return {
    id,
    proposer,
    recipient,
    amount,
    status,
    description,
    createdAt,
    unlockTime: unlockTime ? Number(unlockTime) : undefined,
  };
};

export const useVaultContract = () => {
  const { server } = useSorobanReact();

  const contractAddress = import.meta.env.VITE_CONTRACT_ADDRESS as string | undefined;

  const getCounter = useCallback(async (): Promise<number> => {
    if (!server || !contractAddress) {
      return 0;
    }

    const counterKeys = ['NextProposalId', 'next_proposal_id', 'proposal_count'];
    for (const key of counterKeys) {
      try {
        const typedKey = key as unknown as ContractDataKey;
        const result = await server.getContractData(contractAddress, typedKey);
        const val = unwrapVal(result);
        const parsed = Number(String(val));
        if (Number.isFinite(parsed) && parsed >= 0) {
          return parsed;
        }
      } catch {
        // Try next key.
      }
    }
    return 0;
  }, [contractAddress, server]);

  const getProposalById = useCallback(
    async (id: number): Promise<Proposal | null> => {
      if (!server || !contractAddress) {
        return null;
      }

      const keysToTry: ContractDataKey[] = [
        `proposal_${id}` as unknown as ContractDataKey,
        `Proposal(${id})` as unknown as ContractDataKey,
        { Proposal: id } as unknown as ContractDataKey,
        id as unknown as ContractDataKey,
      ];

      for (const key of keysToTry) {
        try {
          const result = await server.getContractData(contractAddress, key);
          return parseProposal(id, result);
        } catch {
          // Try next key format.
        }
      }

      return null;
    },
    [contractAddress, server]
  );

  const getProposals = useCallback(async (): Promise<Proposal[]> => {
    try {
      if (!contractAddress) {
        throw new Error('Contract address not configured');
      }

      if (!server) {
        throw new Error('Soroban server not available');
      }

      const proposalCount = await getCounter();
      const proposals: Proposal[] = [];

      for (let i = 0; i < proposalCount; i++) {
        try {
          const proposal = await getProposalById(i);
          if (proposal) {
            proposals.push(proposal);
          }
        } catch (error) {
          console.error(`Error fetching proposal ${i}:`, error);
        }
      }

      return proposals;
    } catch (error) {
      console.error('Error fetching proposals:', error);
      throw new Error('Failed to fetch proposals from contract');
    }
  }, [contractAddress, getCounter, getProposalById, server]);

  return {
    getProposals,
  };
};
