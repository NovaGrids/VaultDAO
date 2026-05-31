import { Buffer } from "node:buffer";

/**
 * Decode a Horizon memo into either a decoded proposal id (for memo_hash)
 * or a UTF-8 string (for memo_text). Returns null for decode errors.
 */
export function decodeMemo(
  memoType: string | undefined,
  memo?: string | null,
): { decodedProposalId: number | null; decodedMemo: string | null } {
  if (!memoType) return { decodedProposalId: null, decodedMemo: null };

  try {
    if (memoType === "hash") {
      if (!memo) return { decodedProposalId: null, decodedMemo: null };
      // Horizon provides memo_hash as base64; decode to 32 bytes then take last 8 bytes as big-endian u64
      const buf = Buffer.from(memo, "base64");
      if (buf.length !== 32)
        return { decodedProposalId: null, decodedMemo: null };
      const last8 = buf.slice(24, 32);
      const big = last8.readBigUInt64BE(0);
      // If too large for JS number, return null
      const num = big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : null;
      return { decodedProposalId: num, decodedMemo: null };
    }

    if (memoType === "text") {
      if (memo === undefined || memo === null)
        return { decodedProposalId: null, decodedMemo: null };
      return { decodedProposalId: null, decodedMemo: String(memo) };
    }

    // other memo types not decoded
    return { decodedProposalId: null, decodedMemo: null };
  } catch {
    return { decodedProposalId: null, decodedMemo: null };
  }
}

export default decodeMemo;
