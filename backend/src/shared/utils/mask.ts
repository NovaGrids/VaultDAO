/**
 * Soroban / Stellar contract ID masking for logs and public APIs.
 */

/**
 * Shortens a contract ID for safe display (e.g. logs, production health JSON).
 * IDs with length ≤10 are returned unchanged.
 */
export function maskContractId(contractId: string): string {
  if (contractId.length <= 10) return contractId;
  return `${contractId.slice(0, 6)}...${contractId.slice(-6)}`;
}

/**
 * Contract ID exposed in public HTTP responses (`/health`, `/api/v1/status`, etc.).
 * - **Non-production** (`development`, `test`, …): full value for local debugging.
 * - **production**: masked via {@link maskContractId}.
 */
export function publicContractIdForApi(
  contractId: string,
  nodeEnv: string,
): string {
  if (nodeEnv === "production") {
    return maskContractId(contractId);
  }
  return contractId;
}
