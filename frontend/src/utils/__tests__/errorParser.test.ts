import { describe, it, expect } from 'vitest';
import { parseError } from '../errorParser';
import type { VaultError } from '../errorParser';

// ─── helpers ────────────────────────────────────────────────────────────────

/** Assert that the result is a fully-formed VaultError. */
function assertVaultError(result: unknown): asserts result is VaultError {
  expect(result).toMatchObject({ code: expect.any(String), _parsed: true });
}

// ─── null / undefined ───────────────────────────────────────────────────────

describe('parseError — null / undefined input', () => {
  it('returns UNKNOWN for null', () => {
    const result = parseError(null);
    assertVaultError(result);
    expect(result.code).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for undefined', () => {
    const result = parseError(undefined);
    assertVaultError(result);
    expect(result.code).toBe('UNKNOWN');
  });

  it('returns UNKNOWN for false', () => {
    const result = parseError(false);
    assertVaultError(result);
    expect(result.code).toBe('UNKNOWN');
  });
});

// ─── already-parsed pass-through ────────────────────────────────────────────

describe('parseError — already-parsed VaultError pass-through', () => {
  it('returns the same object when _parsed is true (no double-wrapping)', () => {
    const pre: VaultError = { code: 'TX_FAILED', message: 'tx failed', _parsed: true };
    const result = parseError(pre);
    expect(result).toBe(pre);
  });
});

// ─── wallet errors ───────────────────────────────────────────────────────────

describe('parseError — wallet errors', () => {
  it('detects Freighter rejection by title field', () => {
    const result = parseError({ title: 'Freighter Error', message: 'rejected' });
    expect(result.code).toBe('WALLET_REJECTED');
  });

  it('detects wallet rejection by "user declined" message', () => {
    const result = parseError(new Error('user declined the request'));
    expect(result.code).toBe('WALLET_REJECTED');
  });

  it('detects wallet rejection by "user rejected" message', () => {
    const result = parseError(new Error('user rejected signing'));
    expect(result.code).toBe('WALLET_REJECTED');
  });

  it('detects wallet rejection by "cancelled" message', () => {
    const result = parseError(new Error('Transaction cancelled by user'));
    expect(result.code).toBe('WALLET_REJECTED');
  });

  it('detects WALLET_NOT_CONNECTED via parseWalletError (not connected)', () => {
    // 'not connected' is caught by parseWalletError before any later step
    const result = parseError(new Error('not connected'));
    expect(result.code).toBe('WALLET_NOT_CONNECTED');
  });

  it('detects WALLET_ERROR for message containing generic "wallet" keyword', () => {
    // msg.includes('wallet') hits WALLET_ERROR branch before step-8
    const result = parseError(new Error('Please connect your wallet first'));
    expect(result.code).toBe('WALLET_ERROR');
  });
});

// ─── contract error codes ────────────────────────────────────────────────────

describe('parseError — contract error codes (Error(Contract, #N))', () => {
  const cases: Array<[number, string]> = [
    [1, 'ALREADY_INITIALIZED'],
    [10, 'UNAUTHORIZED'],
    [20, 'PROPOSAL_NOT_FOUND'],
    [40, 'INVALID_AMOUNT'],
    [70, 'INSUFFICIENT_BALANCE'],
    [80, 'SIGNER_ALREADY_EXISTS'],
  ];

  for (const [code, expected] of cases) {
    it(`maps contract code #${code} → ${expected}`, () => {
      const result = parseError(new Error(`Error(Contract, #${code})`));
      expect(result.code).toBe(expected);
    });
  }

  it('falls back to CONTRACT_ERROR_<N> for unknown contract code', () => {
    const result = parseError(new Error('Error(Contract, #999)'));
    expect(result.code).toBe('CONTRACT_ERROR_999');
  });
});

// ─── Soroban host errors ─────────────────────────────────────────────────────

describe('parseError — Soroban host errors', () => {
  it('maps Error(WasmVm, ...) to CONTRACT_EXECUTION_ERROR', () => {
    const result = parseError(new Error('Error(WasmVm, InvalidAction)'));
    expect(result.code).toBe('CONTRACT_EXECUTION_ERROR');
  });

  it('maps Error(Auth, ...) to UNAUTHORIZED', () => {
    const result = parseError(new Error('Error(Auth, InvalidAction)'));
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('maps Error(Budget, ...) to GAS_LIMIT_EXCEEDED', () => {
    const result = parseError(new Error('Error(Budget, ExceededLimit)'));
    expect(result.code).toBe('GAS_LIMIT_EXCEEDED');
  });

  it('maps HostError to CONTRACT_EXECUTION_ERROR', () => {
    const result = parseError(new Error('HostError: type_error'));
    expect(result.code).toBe('CONTRACT_EXECUTION_ERROR');
  });
});

// ─── network / RPC errors ────────────────────────────────────────────────────

describe('parseError — network / RPC errors', () => {
  it('maps "failed to fetch" to NETWORK_OFFLINE', () => {
    const result = parseError(new Error('failed to fetch'));
    expect(result.code).toBe('NETWORK_OFFLINE');
  });

  it('maps "timeout" to RPC_TIMEOUT', () => {
    const result = parseError(new Error('Request timed out'));
    expect(result.code).toBe('RPC_TIMEOUT');
  });

  it('maps "wrong network" to NETWORK_MISMATCH', () => {
    const result = parseError(new Error('wrong network detected'));
    expect(result.code).toBe('NETWORK_MISMATCH');
  });

  it('maps generic "rpc" keyword to RPC_ERROR', () => {
    const result = parseError(new Error('rpc call returned error'));
    expect(result.code).toBe('RPC_ERROR');
  });
});

// ─── transaction result errors ───────────────────────────────────────────────

describe('parseError — transaction result errors', () => {
  it('maps txBAD_AUTH to UNAUTHORIZED', () => {
    const result = parseError(new Error('txBAD_AUTH'));
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('maps txINSUFFICIENT_BALANCE to INSUFFICIENT_BALANCE', () => {
    const result = parseError(new Error('txINSUFFICIENT_BALANCE'));
    expect(result.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('maps txNO_ACCOUNT to ACCOUNT_NOT_FOUND', () => {
    const result = parseError(new Error('txNO_ACCOUNT'));
    expect(result.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('maps txFAILED to TX_FAILED', () => {
    const result = parseError(new Error('txFAILED'));
    expect(result.code).toBe('TX_FAILED');
  });
});

// ─── Soroban simulation object ───────────────────────────────────────────────

describe('parseError — Soroban simulation object ({ error: string })', () => {
  it('parses a contract error code embedded in a simulation error object', () => {
    const result = parseError({ error: 'Error(Contract, #10)' });
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('parses RPC JSON error with code -32600', () => {
    const result = parseError({ code: -32600, message: 'invalid request' });
    expect(result.code).toBe('RPC_ERROR');
  });

  it('parses RPC timeout when code is -32000 and message includes timeout', () => {
    const result = parseError({ code: -32000, message: 'timeout' });
    expect(result.code).toBe('RPC_TIMEOUT');
  });
});

// ─── Horizon result codes ────────────────────────────────────────────────────

describe('parseError — Horizon result codes', () => {
  const makeHorizonError = (ops: string[], tx: string) => ({
    message: 'transaction failed',
    response: {
      data: {
        extras: {
          result_codes: { operations: ops, transaction: tx },
        },
      },
    },
  });

  it('maps op_bad_auth to UNAUTHORIZED', () => {
    const result = parseError(makeHorizonError(['op_bad_auth'], 'tx_failed'));
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('maps tx_bad_auth to UNAUTHORIZED', () => {
    const result = parseError(makeHorizonError([], 'tx_bad_auth'));
    expect(result.code).toBe('UNAUTHORIZED');
  });

  it('maps op_no_trust to INSUFFICIENT_BALANCE', () => {
    const result = parseError(makeHorizonError(['op_no_trust'], 'tx_failed'));
    expect(result.code).toBe('INSUFFICIENT_BALANCE');
  });

  it('maps tx_no_account to ACCOUNT_NOT_FOUND', () => {
    const result = parseError(makeHorizonError([], 'tx_no_account'));
    expect(result.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

// ─── misc message-based rules ────────────────────────────────────────────────

describe('parseError — miscellaneous message-based rules', () => {
  it('maps "not connected" (no wallet substring) to WALLET_NOT_CONNECTED', () => {
    // parseWalletError: 'not connected' hits the WALLET_NOT_CONNECTED branch
    // (does NOT contain 'wallet'/'freighter' so WALLET_ERROR branch is skipped)
    const result = parseError(new Error('not connected'));
    expect(result.code).toBe('WALLET_NOT_CONNECTED');
  });

  it('maps "Wrong network" to NETWORK_MISMATCH', () => {
    const result = parseError(new Error('Wrong network'));
    expect(result.code).toBe('NETWORK_MISMATCH');
  });

  it('maps "not configured" to CONTRACT_NOT_CONFIGURED', () => {
    const result = parseError(new Error('Contract is not configured'));
    expect(result.code).toBe('CONTRACT_NOT_CONFIGURED');
  });

  it('always sets _parsed: true on output', () => {
    const result = parseError(new Error('anything'));
    expect(result._parsed).toBe(true);
  });

  it('always includes a message string', () => {
    const result = parseError(new Error('some error'));
    expect(typeof result.message).toBe('string');
  });
});
