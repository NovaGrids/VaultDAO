import { xdr } from 'stellar-sdk';

/**
 * Return a copy of an on-chain `Config` ScVal (as returned by `get_config`)
 * with `signer` appended to its `signers` vector.
 *
 * Working on the raw ScVal keeps every other config field byte-for-byte
 * identical, so the resulting value can be passed straight to
 * `propose_vault_config_change` without re-encoding the full struct.
 */
export function buildConfigWithAddedSigner(config: xdr.ScVal, signer: xdr.ScVal): xdr.ScVal {
    if (config.switch() !== xdr.ScValType.scvMap()) {
        throw new Error('Unexpected vault config format');
    }
    const entries = config.map() ?? [];
    const signersIndex = entries.findIndex((entry) => {
        const key = entry.key();
        return key.switch() === xdr.ScValType.scvSymbol() && key.sym().toString() === 'signers';
    });
    if (signersIndex === -1) {
        throw new Error('Vault config has no signers field');
    }

    const signersEntry = entries[signersIndex];
    const signers = signersEntry.val().vec() ?? [];
    const signerXdr = signer.toXDR('base64');
    if (signers.some((existing) => existing.toXDR('base64') === signerXdr)) {
        throw new Error('Address is already a signer');
    }

    const updatedEntries = entries.slice();
    updatedEntries[signersIndex] = new xdr.ScMapEntry({
        key: signersEntry.key(),
        val: xdr.ScVal.scvVec([...signers, signer]),
    });
    return xdr.ScVal.scvMap(updatedEntries);
}
