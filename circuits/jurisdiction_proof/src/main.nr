// jurisdiction_proof
//
// Proves "my country of residence is NOT in the restricted list" without
// revealing which country it is, bound to a commitment a trusted issuer signed
// (secp256k1 ECDSA, in-circuit). Country codes are ISO 3166-1 numeric
// (US=840, IR=364, KP=408); unused slots in the restricted list are 0.

use dep::poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256k1::verify_signature;

global RESTRICTED_LEN: u32 = 8;

fn main(
    // private
    country_code: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    restricted: pub [u64; RESTRICTED_LEN],
    context_id: pub Field,
) -> pub Field {
    assert(Poseidon2::hash([country_code as Field, salt], 2) == commitment);
    let z: [u8; 32] = commitment.to_be_bytes();
    assert(verify_signature(issuer_x, issuer_y, sig, z));
    for i in 0..RESTRICTED_LEN {
        assert(country_code != restricted[i]);
    }
    Poseidon2::hash([salt, context_id], 2)
}

#[test]
fn nullifier_is_deterministic_for_same_credential_and_context() {
    let secret = 566;
    let context_id = 7;
    let n1 = Poseidon2::hash([secret, context_id], 2);
    let n2 = Poseidon2::hash([secret, context_id], 2);
    assert(n1 == n2);
}

#[test]
fn nullifier_differs_across_contexts_for_same_credential() {
    let secret = 566;
    let n_ctx_a = Poseidon2::hash([secret, 1], 2);
    let n_ctx_b = Poseidon2::hash([secret, 2], 2);
    assert(n_ctx_a != n_ctx_b);
}

#[test]
fn nullifier_differs_across_credentials_for_same_context() {
    let context_id = 7;
    let n_cred_a = Poseidon2::hash([566, context_id], 2);
    let n_cred_b = Poseidon2::hash([840, context_id], 2);
    assert(n_cred_a != n_cred_b);
}