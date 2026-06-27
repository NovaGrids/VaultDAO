/** Supported Soroban argument types for ABI validation. */
export type AbiArgType =
  | "Address"
  | "i128"
  | "u32"
  | "bool"
  | "Bytes"
  | "Symbol"
  | "Vec";

export interface AbiArg {
  readonly name: string;
  readonly type: AbiArgType;
}

export interface AbiFunctionSpec {
  readonly args: AbiArg[];
}

/** Full ABI for a contract version. */
export interface ContractABI {
  readonly version: string;
  readonly functions: Record<string, AbiFunctionSpec>;
}

export interface AbiValidationError {
  readonly fn_name: string;
  readonly error: string;
}

export type AbiValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: AbiValidationError };
