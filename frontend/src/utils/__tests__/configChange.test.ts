import { describe, it, expect } from 'vitest';
import { Keypair, nativeToScVal, scValToNative, xdr, Address } from 'stellar-sdk';
import { buildConfigWithAddedSigner } from '../configChange';

const addr = () => Keypair.random().publicKey();

function makeConfig(signers: string[]): xdr.ScVal {
    return xdr.ScVal.scvMap([
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('daily_limit'),
            val: nativeToScVal(1000n, { type: 'i128' }),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('signers'),
            val: xdr.ScVal.scvVec(signers.map((s) => new Address(s).toScVal())),
        }),
        new xdr.ScMapEntry({
            key: xdr.ScVal.scvSymbol('threshold'),
            val: nativeToScVal(2, { type: 'u32' }),
        }),
    ]);
}

describe('buildConfigWithAddedSigner', () => {
    it('appends the signer and preserves every other field', () => {
        const [a, b, c] = [addr(), addr(), addr()];
        const config = makeConfig([a, b]);

        const updated = buildConfigWithAddedSigner(config, new Address(c).toScVal());
        const native = scValToNative(updated) as Record<string, unknown>;

        expect(native.signers).toEqual([a, b, c]);
        expect(native.threshold).toBe(2);
        expect(native.daily_limit).toBe(1000n);
        // original is not mutated
        expect((scValToNative(config) as { signers: string[] }).signers).toEqual([a, b]);
    });

    it('rejects an address that is already a signer', () => {
        const a = addr();
        expect(() => buildConfigWithAddedSigner(makeConfig([a]), new Address(a).toScVal()))
            .toThrow('already a signer');
    });

    it('rejects a config without a signers field', () => {
        const bad = xdr.ScVal.scvMap([]);
        expect(() => buildConfigWithAddedSigner(bad, new Address(addr()).toScVal()))
            .toThrow('no signers field');
    });
});
