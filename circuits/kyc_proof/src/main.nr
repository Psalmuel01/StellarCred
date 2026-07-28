// kyc_proof
//
// Proves the holder knows the secret behind a KYC credential AND that a trusted
// issuer signed the commitment to it (secp256k1 ECDSA, verified in-circuit).
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

use dep::poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256k1::verify_signature;

fn main(
    secret: Field,
    salt: Field,
    sig: [u8; 64],
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    context_id: pub Field,
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