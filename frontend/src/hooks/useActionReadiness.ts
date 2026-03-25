import { useWallet } from './useWallet';
import { env } from '../config/env';

export interface ReadinessResult {
  ready: boolean;
  message: string | null;
}

/**
 * Returns readiness state for vault mutation actions.
 * Checks wallet connection, network match, and required env config.
 */
export const useActionReadiness = (): {
  checkReady: () => ReadinessResult;
  isReady: boolean;
  readinessMessage: string | null;
} => {
  const { isConnected, network } = useWallet();

  const checkReady = (): ReadinessResult => {
    if (!isConnected) {
      return { ready: false, message: 'Please connect your wallet before performing this action.' };
    }

    if (network && network.toUpperCase() !== env.stellarNetwork.toUpperCase()) {
      return {
        ready: false,
        message: `Wrong network. Please switch your wallet to ${env.stellarNetwork}.`,
      };
    }

    if (!env.contractId) {
      return { ready: false, message: 'Contract is not configured. Check your environment settings.' };
    }

    return { ready: true, message: null };
  };

  const result = checkReady();

  return {
    checkReady,
    isReady: result.ready,
    readinessMessage: result.message,
  };
};
