import type {
  AbiArgType,
  AbiValidationResult,
  ContractABI,
} from "./contract-abi.js";

const TYPE_VALIDATORS: Record<AbiArgType, (v: unknown) => boolean> = {
  Address: (v) => typeof v === "string" && v.length > 0,
  i128: (v) =>
    typeof v === "string"
      ? /^-?\d+$/.test(v)
      : typeof v === "number" || typeof v === "bigint",
  u32: (v) =>
    (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 4294967295) ||
    (typeof v === "string" && /^\d+$/.test(v) && Number(v) <= 4294967295),
  bool: (v) => typeof v === "boolean",
  Bytes: (v) => typeof v === "string" || Buffer.isBuffer(v),
  Symbol: (v) => typeof v === "string",
  Vec: (v) => Array.isArray(v),
};

/**
 * Synchronously validates a contract function invocation against its ABI spec.
 * Returns ok:true on success or ok:false with a structured error.
 */
export function validateInvocation(
  abi: ContractABI,
  fn_name: string,
  args: unknown[],
): AbiValidationResult {
  const spec = abi.functions[fn_name];
  if (!spec) {
    return {
      ok: false,
      error: { fn_name, error: `Unknown function "${fn_name}" in ABI v${abi.version}` },
    };
  }

  if (args.length !== spec.args.length) {
    return {
      ok: false,
      error: {
        fn_name,
        error: `Argument count mismatch: expected ${spec.args.length}, got ${args.length}`,
      },
    };
  }

  for (let i = 0; i < spec.args.length; i++) {
    const argSpec = spec.args[i]!;
    const value = args[i];
    const validator = TYPE_VALIDATORS[argSpec.type];
    if (!validator(value)) {
      return {
        ok: false,
        error: {
          fn_name,
          error: `Argument "${argSpec.name}" (index ${i}) expected type ${argSpec.type}, got ${typeof value} (${JSON.stringify(value)})`,
        },
      };
    }
  }

  return { ok: true };
}
