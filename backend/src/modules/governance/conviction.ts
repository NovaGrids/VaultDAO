/**
 * Deterministic conviction / weight decay for delegated voting (issue #2223).
 *
 * All arithmetic is performed with bigint integers and fixed basis-point
 * constants. No floating point, wall-clock time or ledger-specific rounding is
 * involved, so an identical (weight, elapsedLedgers, params) triple yields the
 * identical weight on every ledger and every node.
 */

export const BPS = 10_000n;

export interface ConvictionParams {
  /** Basis points of weight removed per decay step (0..10_000). */
  decayBps: number;
  /** Ledgers between decay steps (> 0). */
  stepLedgers: number;
  /** Floor retained, in basis points of the original weight (0..10_000). */
  floorBps: number;
}

export const DEFAULT_CONVICTION_PARAMS: Readonly<ConvictionParams> =
  Object.freeze({ decayBps: 100, stepLedgers: 1_000, floorBps: 1_000 });

/** Returns human-readable validation errors; empty means valid. */
export function validateConvictionParams(
  params: ConvictionParams,
): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(params.decayBps) || params.decayBps < 0 || params.decayBps > 10_000) {
    errors.push("decayBps must be an integer between 0 and 10000");
  }
  if (!Number.isInteger(params.stepLedgers) || params.stepLedgers <= 0) {
    errors.push("stepLedgers must be a positive integer");
  }
  if (!Number.isInteger(params.floorBps) || params.floorBps < 0 || params.floorBps > 10_000) {
    errors.push("floorBps must be an integer between 0 and 10000");
  }
  if (errors.length === 0 && params.decayBps + params.floorBps > 10_000) {
    errors.push("decayBps + floorBps must not exceed 10000");
  }
  return errors;
}

/** Throws when a config-change carries invalid decay parameters. */
export function assertValidConvictionParams(params: ConvictionParams): void {
  const errors = validateConvictionParams(params);
  if (errors.length > 0) {
    throw new Error(`Invalid conviction params: ${errors.join("; ")}`);
  }
}

function pow(base: bigint, exponent: number): bigint {
  let result = 1n;
  let b = base;
  let e = exponent;
  while (e > 0) {
    if (e % 2 === 1) result *= b;
    b *= b;
    e = Math.floor(e / 2);
  }
  return result;
}

/**
 * Weight after `elapsedLedgers` of decay. Integer exponentiation means no
 * per-ledger iteration and no floating-point drift, even for very long gaps.
 * The result never drops below `floorBps` of the original weight.
 */
export function decayWeight(
  initialWeight: bigint | string,
  elapsedLedgers: number,
  params: ConvictionParams = DEFAULT_CONVICTION_PARAMS as ConvictionParams,
): bigint {
  assertValidConvictionParams(params);
  if (!Number.isFinite(elapsedLedgers) || elapsedLedgers < 0) {
    throw new Error("elapsedLedgers must be a non-negative finite number");
  }
  const weight = typeof initialWeight === "bigint" ? initialWeight : BigInt(initialWeight);
  if (weight <= 0n) return 0n;

  const steps = Math.floor(elapsedLedgers / params.stepLedgers);
  const numerator = weight * pow(BPS - BigInt(params.decayBps), steps);
  const denominator = pow(BPS, steps);
  const decayed = numerator / denominator;
  const floor = (weight * BigInt(params.floorBps)) / BPS;
  return decayed > floor ? decayed : floor;
}
