// Type shim for @stellar/stellar-base which ships without .d.ts files.
// stellar-sdk re-exports everything from this package via `export * from '@stellar/stellar-base'`
declare module '@stellar/stellar-base' {
  export namespace xdr {
    class ScVal {
      static fromXDR(data: string, encoding: 'base64' | 'hex'): ScVal;
      static scvSymbol(value: string): ScVal;
      toXDR(encoding?: 'base64' | 'hex'): string;
    }
    class HostFunction {
      static hostFunctionTypeInvokeContract(args: InvokeContractArgs): HostFunction;
    }
    class InvokeContractArgs {
      constructor(args: { contractAddress: unknown; functionName: string; args: ScVal[] }): InvokeContractArgs;
    }
  }

  export class Address {
    constructor(address: string);
    static fromString(address: string): Address;
    toScVal(): xdr.ScVal;
    toScAddress(): unknown;
  }

  export class Operation {
    static invokeHostFunction(opts: { func: unknown; auth: unknown[] }): unknown;
  }

  export interface Transaction {
    toXDR(): string;
  }

  export class TransactionBuilder {
    constructor(account: unknown, opts: { fee: string });
    setNetworkPassphrase(passphrase: string): this;
    setTimeout(timeout: number): this;
    addOperation(op: unknown): this;
    build(): Transaction;
    static fromXDR(xdr: string, networkPassphrase: string): Transaction;
  }

  export class StrKey {
    static isValidEd25519PublicKey(key: string): boolean;
    static isValidMed25519PublicKey(key: string): boolean;
  }

  export function nativeToScVal(value: unknown, opts?: { type?: string }): xdr.ScVal;
  export function scValToNative(val: xdr.ScVal): unknown;
}
