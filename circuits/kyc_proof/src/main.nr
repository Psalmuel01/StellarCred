// kyc_proof
//
// Proves the holder knows the secret behind a KYC credential AND that a trusted
// issuer signed the commitment to it (secp256k1 ECDSA, verified in-circuit).
// Public inputs, in order: commitment, issuer_x, issuer_y, so the contract can
// bind the public key to the registered issuer. The signature and secret stay
// private.

use dep::credential_lib;

fn main(
    // private: never leaves the holder's device, never appears in public inputs
    secret: Field,
    salt: Field,
    sig: [u8; 64],
    // public: the contract sees these and binds them to on-chain state
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
) {
    // This single call is the whole circuit. It enforces both halves of the
    // trust model, and circuits/lib/src/lib.nr documents in detail what each
    // constraint buys and what breaks without it:
    //   - Poseidon2([secret, salt], 2) == commitment, binding the private
    //     witness to the credential the issuer signed. Without it a holder
    //     could present someone else's signed commitment while knowing nothing
    //     about the credential behind it.
    //   - An in-circuit secp256k1 signature check over the commitment, so a
    //     valid proof is evidence a specific issuer key signed this exact
    //     commitment rather than one the holder minted themselves. The
    //     signature stays private, which is what keeps a holder's proofs
    //     unlinkable.
    //
    // Unlike the other credential circuits there is no threshold assertion
    // here, and that is the design: KYC is a boolean claim. The proof asserts
    // only "a trusted issuer signed a KYC credential and I know its secret".
    // The secret carries no ordering or magnitude to compare against, so there
    // is nothing further to constrain.
    //
    // Because the circuit reduces to this one call, the contract carries more of
    // the weight here than elsewhere. It MUST check (issuer_x, issuer_y)
    // against IssuerRegistry, including that the key is registered for the KYC
    // credential type. This proof establishes that *some* keypair signed the
    // commitment; only the registry lookup makes that keypair a trusted issuer.
    credential_lib::assert_committed_and_signed(secret, salt, sig, commitment, issuer_x, issuer_y);
}
