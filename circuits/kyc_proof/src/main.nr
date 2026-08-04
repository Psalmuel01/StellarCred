// kyc_proof
//
// Proves the holder knows the secret behind a KYC credential AND that a trusted
// issuer signed the commitment to it (secp256k1 ECDSA, verified in-circuit).
<<<<<<< HEAD
// Public inputs, in order: commitment, issuer_x, issuer_y, context_id, nullifier.
=======
// Public inputs, in order: commitment, issuer_x, issuer_y, context_id, then the
// nullifier as the public return value. The signature and secret stay private.
//
// Nullifier: Poseidon2([secret, context_id], 2). Same secret + same context_id
// always yields the same nullifier (lets a protocol detect reuse of this exact
// credential within its own context). Different context_id values yield
// unrelated nullifiers for the same secret — Poseidon2 is a random oracle in
// this argument, so without knowing `secret` an observer cannot link a
// nullifier in context A to a nullifier in context B, or learn anything about
// the holder from either value alone.
>>>>>>> b2864dac3a2dd97dbc8978c850eefc88f3e86599

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
    context_id: pub Field,
<<<<<<< HEAD
    nullifier: pub Field,
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

    // Nullifier: deterministic per credential+context, unrelated to identity.
    // Same salt + same context_id -> same nullifier; different context_id ->
    // unlinkable nullifier.
    assert(Poseidon2::hash([salt, context_id], 2) == nullifier);
=======
) -> pub Field {
    assert(Poseidon2::hash([secret, salt], 2) == commitment);
    let z: [u8; 32] = commitment.to_be_bytes();
    assert(verify_signature(issuer_x, issuer_y, sig, z));
    Poseidon2::hash([secret, context_id], 2)
}

#[test]
fn nullifier_is_deterministic_for_same_credential_and_context() {
    let secret = 42;
    let context_id = 7;
    let n1 = Poseidon2::hash([secret, context_id], 2);
    let n2 = Poseidon2::hash([secret, context_id], 2);
    assert(n1 == n2);
}

#[test]
fn nullifier_differs_across_contexts_for_same_credential() {
    let secret = 42;
    let n_ctx_a = Poseidon2::hash([secret, 1], 2);
    let n_ctx_b = Poseidon2::hash([secret, 2], 2);
    assert(n_ctx_a != n_ctx_b);
}

#[test]
fn nullifier_differs_across_credentials_for_same_context() {
    let context_id = 7;
    let n_cred_a = Poseidon2::hash([42, context_id], 2);
    let n_cred_b = Poseidon2::hash([99, context_id], 2);
    assert(n_cred_a != n_cred_b);
}
>>>>>>> b2864dac3a2dd97dbc8978c850eefc88f3e86599
