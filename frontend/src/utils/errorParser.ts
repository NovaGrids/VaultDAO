export interface VaultError {
  code: string;
  message: string;
  debug?: string;
  /** Set to true to mark this as already parsed — prevents double-wrapping. */
  _parsed?: true;
}

const isObj = (e: unknown): e is Record<string, unknown> =>
  typeof e === 'object' && e !== null;

/** Extract a raw string message from any thrown value. */
const rawMessage = (error: unknown): string => {
  if (isObj(error)) {
    const msg = error['message'];
    if (typeof msg === 'string') return msg;
  }
  if (typeof error === 'string') return error;
  return '';
};

/**
 * Contract error code → VaultError code.
 * Matches VaultError enum in contracts/vault/src/errors.rs.
 */
const CONTRACT_CODE_MAP: Record<number, string> = {
  1: 'ALREADY_INITIALIZED',
  2: 'NOT_INITIALIZED',
  3: 'NO_SIGNERS',
  4: 'THRESHOLD_TOO_LOW',
  5: 'THRESHOLD_TOO_HIGH',
  6: 'QUORUM_TOO_HIGH',
  7: 'QUORUM_NOT_REACHED',
  10: 'UNAUTHORIZED',
  11: 'NOT_A_SIGNER',
  12: 'INSUFFICIENT_ROLE',
  13: 'VOTER_NOT_IN_SNAPSHOT',
  20: 'PROPOSAL_NOT_FOUND',
  21: 'PROPOSAL_NOT_PENDING',
  22: 'PROPOSAL_NOT_APPROVED',
  23: 'PROPOSAL_ALREADY_EXECUTED',
  24: 'PROPOSAL_EXPIRED',
  25: 'PROPOSAL_ALREADY_CANCELLED',
  26: 'VOTING_DEADLINE_PASSED',
  30: 'ALREADY_APPROVED',
  40: 'INVALID_AMOUNT',
  41: 'EXCEEDS_PROPOSAL_LIMIT',
  42: 'EXCEEDS_DAILY_LIMIT',
  43: 'EXCEEDS_WEEKLY_LIMIT',
  50: 'VELOCITY_LIMIT_EXCEEDED',
  60: 'TIMELOCK_NOT_EXPIRED',
  61: 'SCHEDULING_ERROR',
  70: 'INSUFFICIENT_BALANCE',
  71: 'TRANSFER_FAILED',
  80: 'SIGNER_ALREADY_EXISTS',
  81: 'SIGNER_NOT_FOUND',
  82: 'CANNOT_REMOVE_SIGNER',
  90: 'RECIPIENT_NOT_WHITELISTED',
  91: 'RECIPIENT_BLACKLISTED',
  92: 'ADDRESS_ALREADY_ON_LIST',
  93: 'ADDRESS_NOT_ON_LIST',
  110: 'INSURANCE_INSUFFICIENT',
  120: 'GAS_LIMIT_EXCEEDED',
  130: 'BATCH_TOO_LARGE',
  140: 'CONDITIONS_NOT_MET',
  150: 'INTERVAL_TOO_SHORT',
  160: 'DEX_ERROR',
  168: 'RETRY_ERROR',
  210: 'TEMPLATE_NOT_FOUND',
  211: 'TEMPLATE_INACTIVE',
  212: 'TEMPLATE_VALIDATION_FAILED',
  220: 'FUNDING_ROUND_ERROR',
  230: 'ATTACHMENT_HASH_INVALID',
  231: 'TOO_MANY_ATTACHMENTS',
  232: 'TOO_MANY_TAGS',
  233: 'METADATA_VALUE_INVALID',
};

/** Parse `Error(Contract, #N)` patterns from Soroban simulation/RPC output. */
function parseContractErrorCode(log: string): string | null {
  const match = log.match(/Error\(Contract,\s*#(\d+)\)/);
  if (!match) return null;
  const num = parseInt(match[1], 10);
  return CONTRACT_CODE_MAP[num] ?? `CONTRACT_ERROR_${num}`;
}

/** Parse Horizon transaction result codes (e.g. op_bad_auth, op_no_trust). */
function parseHorizonResultCodes(error: unknown): string | null {
  if (!isObj(error)) return null;
  // Horizon SDK wraps result codes under response.data.extras.result_codes
  const response = (error as Record<string, unknown>)['response'];
  const data = isObj(response) ? (response as Record<string, unknown>)['data'] : null;
  const extras = isObj(data) ? (data as Record<string, unknown>)['extras'] : null;
  const resultCodes = isObj(extras) ? (extras as Record<string, unknown>)['result_codes'] : null;
  if (!isObj(resultCodes)) return null;
  const ops = (resultCodes as Record<string, unknown>)['operations'];
  const tx = (resultCodes as Record<string, unknown>)['transaction'];
  const opCode = Array.isArray(ops) ? String(ops[0] ?? '') : '';
  const txCode = typeof tx === 'string' ? tx : '';
  if (opCode.includes('op_bad_auth') || txCode.includes('tx_bad_auth')) return 'UNAUTHORIZED';
  if (opCode.includes('op_no_trust') || opCode.includes('op_low_reserve')) return 'INSUFFICIENT_BALANCE';
  if (txCode.includes('tx_insufficient_balance') || opCode.includes('op_underfunded')) return 'INSUFFICIENT_BALANCE';
  if (txCode.includes('tx_no_account')) return 'ACCOUNT_NOT_FOUND';
  if (txCode.includes('tx_failed') || opCode.length > 0) return 'TX_FAILED';
  return null;
}

/** Parse Soroban simulation error objects (not just string messages). */
function parseSorobanSimulationObject(error: unknown): string | null {
  if (!isObj(error)) return null;
  // SorobanRpc simulation error shape: { error: string, events?: [...] }
  const simError = (error as Record<string, unknown>)['error'];
  if (typeof simError === 'string') {
    const contractCode = parseContractErrorCode(simError);
    if (contractCode) return contractCode;
    const hostCode = parseSorobanHostError(simError);
    if (hostCode) return hostCode;
    const netCode = parseNetworkError(simError);
    if (netCode) return netCode;
  }
  // RPC JSON error shape: { code: number, message: string }
  const rpcCode = (error as Record<string, unknown>)['code'];
  const rpcMsg = rawMessage(error).toLowerCase();
  if (typeof rpcCode === 'number') {
    if (rpcCode === -32600 || rpcCode === -32601) return 'RPC_ERROR';
    if (rpcCode === -32000) return rpcMsg.includes('timeout') ? 'RPC_TIMEOUT' : 'RPC_ERROR';
  }
  return null;
}

/** Parse Soroban host/wasm error types. */
function parseSorobanHostError(log: string): string | null {
  if (log.includes('Error(WasmVm,') || log.includes('Error(Value,')) return 'CONTRACT_EXECUTION_ERROR';
  if (log.includes('Error(Auth,')) return 'UNAUTHORIZED';
  if (log.includes('Error(Budget,')) return 'GAS_LIMIT_EXCEEDED';
  if (log.includes('Error(Storage,')) return 'STORAGE_ERROR';
  if (log.includes('HostError') || log.includes('host invocation failed')) return 'CONTRACT_EXECUTION_ERROR';
  return null;
}

/** Parse wallet/Freighter errors. */
function parseWalletError(error: unknown): string | null {
  if (!isObj(error)) return null;
  const title = error['title'];
  const code = error['code'];
  const msg = rawMessage(error).toLowerCase();

  if (title === 'Freighter Error' || String(code) === '-4') return 'WALLET_REJECTED';
  if (msg.includes('user declined') || msg.includes('user rejected') || msg.includes('cancelled')) return 'WALLET_REJECTED';
  if (msg.includes('freighter') || msg.includes('wallet')) return 'WALLET_ERROR';
  if (msg.includes('not connected') || msg.includes('no wallet')) return 'WALLET_NOT_CONNECTED';
  return null;
}

/** Parse network/RPC errors. */
function parseNetworkError(msg: string): string | null {
  const lower = msg.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) return 'NETWORK_OFFLINE';
  if (lower.includes('timeout') || lower.includes('timed out')) return 'RPC_TIMEOUT';
  if (lower.includes('wrong network') || lower.includes('network mismatch')) return 'NETWORK_MISMATCH';
  if (lower.includes('rpc') || lower.includes('soroban') || lower.includes('horizon')) return 'RPC_ERROR';
  if (lower.includes('getevents') || lower.includes('getlatestledger') || lower.includes('sendtransaction')) return 'RPC_ERROR';
  return null;
}

/** Parse transaction submission result errors. */
function parseTxResultError(msg: string): string | null {
  if (msg.includes('txBAD_AUTH') || msg.includes('tx_bad_auth')) return 'UNAUTHORIZED';
  if (msg.includes('txINSUFFICIENT_BALANCE') || msg.includes('tx_insufficient_balance')) return 'INSUFFICIENT_BALANCE';
  if (msg.includes('txNO_ACCOUNT')) return 'ACCOUNT_NOT_FOUND';
  if (msg.includes('txFAILED') || msg.includes('tx_failed')) return 'TX_FAILED';
  if (msg.includes('PENDING') === false && msg.includes('submission failed')) return 'TX_FAILED';
  return null;
}

export const parseError = (error: unknown): VaultError => {
  if (!error) return { code: 'UNKNOWN', message: 'An unknown error occurred.', _parsed: true };

  // Pass-through already-parsed VaultErrors to prevent double-wrapping.
  if (isObj(error) && (error as Record<string, unknown>)['_parsed'] === true) {
    return error as unknown as VaultError;
  }

  const msg = rawMessage(error);
  const debugMsg = import.meta.env.DEV ? msg : undefined;
  const make = (code: string): VaultError => ({ code, message: msg, debug: debugMsg, _parsed: true });

  // 1. Wallet errors (check object shape first)
  const walletCode = parseWalletError(error);
  if (walletCode) return make(walletCode);

  // 2. Horizon result codes (Stellar SDK error objects)
  const horizonCode = parseHorizonResultCodes(error);
  if (horizonCode) return make(horizonCode);

  // 3. Soroban simulation error objects
  const simObjCode = parseSorobanSimulationObject(error);
  if (simObjCode) return make(simObjCode);

  // 4. Contract error codes from simulation/RPC string logs
  const contractCode = parseContractErrorCode(msg);
  if (contractCode) return make(contractCode);

  // 5. Soroban host errors
  const hostCode = parseSorobanHostError(msg);
  if (hostCode) return make(hostCode);

  // 6. Transaction result errors
  const txCode = parseTxResultError(msg);
  if (txCode) return make(txCode);

  // 7. Network/RPC errors
  const netCode = parseNetworkError(msg);
  if (netCode) return make(netCode);

  // 8. Wallet not connected (thrown by assertReady)
  if (msg.includes('connect your wallet') || msg.includes('not connected')) {
    return make('WALLET_NOT_CONNECTED');
  }

  // 9. Wrong network (thrown by assertReady)
  if (msg.includes('Wrong network') || msg.includes('switch your wallet')) {
    return make('NETWORK_MISMATCH');
  }

  // 10. Contract not configured
  if (msg.includes('not configured') || msg.includes('contractId')) {
    return make('CONTRACT_NOT_CONFIGURED');
  }

  return {
    code: 'RPC_ERROR',
    message: msg || 'Failed to submit transaction.',
    debug: debugMsg,
    _parsed: true,
  };
};
