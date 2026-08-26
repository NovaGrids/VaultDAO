/**
 * VaultDAO SDK — Input Validation
 *
 * Client-side guards that catch invalid inputs before XDR serialization.
 * Each validator throws a typed {@link SdkValidationError} with the offending
 * field name, value, and a human-readable message.
 */

export class SdkValidationError extends Error {
  constructor(
    public readonly field: string,
    public readonly value: unknown,
    message: string
  ) {
    super(message);
    this.name = "SdkValidationError";
  }
}

function fail(field: string, value: unknown, message: string): never {
  throw new SdkValidationError(field, value, message);
}

export function validateNonEmptyString(field: string, value: unknown): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail(field, value, `${field} must be a non-empty string`);
  }
}

export function validatePositiveBigInt(field: string, value: unknown): void {
  if (typeof value !== "bigint" || value <= 0n) {
    fail(field, value, `${field} must be a positive bigint`);
  }
}

export function validateNonNegativeBigInt(field: string, value: unknown): void {
  if (typeof value !== "bigint" || value < 0n) {
    fail(field, value, `${field} must be a non-negative bigint`);
  }
}

export function validatePositiveNumber(field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(field, value, `${field} must be a positive integer`);
  }
}

export function validateNonNegativeNumber(field: string, value: unknown): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    fail(field, value, `${field} must be a non-negative integer`);
  }
}

export function validateThreshold(field: string, value: unknown, max?: number): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    fail(field, value, `${field} must be an integer >= 1`);
  }
  if (max !== undefined && value > max) {
    fail(field, value, `${field} must be <= ${max}`);
  }
}

export function validateMinInterval(field: string, value: unknown): void {
  if (typeof value !== "bigint" || value < 720n) {
    fail(field, value, `${field} must be at least 720 ledgers (~1 hour)`);
  }
}

export function validateMemo(field: string, value: unknown): void {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) {
    fail(field, value, `${field} must be a non-empty string of at most 32 characters`);
  }
}

export function validateRole(field: string, value: unknown): void {
  if (value !== 0 && value !== 1 && value !== 2) {
    fail(
      field,
      value,
      `${field} must be a valid Role (0=Member, 1=Treasurer, 2=Admin)`
    );
  }
}

export function validateId(field: string, value: unknown): void {
  if (typeof value !== "bigint" || value < 1n) {
    fail(field, value, `${field} must be a positive bigint`);
  }
}

export function validateStreamLedgers(
  startField: string,
  start: unknown,
  endField: string,
  end: unknown
): void {
  validateNonNegativeBigInt(startField, start);
  validateNonNegativeBigInt(endField, end);
  if (typeof start === "bigint" && typeof end === "bigint" && end <= start) {
    fail(endField, end, `${endField} must be greater than ${startField}`);
  }
}

export function validateInitConfig(config: unknown): void {
  if (typeof config !== "object" || config === null) {
    fail("config", config, "config must be an object");
  }
  const c = config as Record<string, unknown>;
  if (!Array.isArray(c.signers) || c.signers.length === 0) {
    fail("config.signers", c.signers, "config.signers must be a non-empty array");
  }
  validateThreshold("config.threshold", c.threshold, c.signers.length);
  validateNonNegativeBigInt("config.spendingLimit", c.spendingLimit);
  validateNonNegativeBigInt("config.dailyLimit", c.dailyLimit);
  validateNonNegativeBigInt("config.weeklyLimit", c.weeklyLimit);
  validateNonNegativeBigInt("config.timelockThreshold", c.timelockThreshold);
  validateNonNegativeBigInt("config.timelockDelay", c.timelockDelay);
}
