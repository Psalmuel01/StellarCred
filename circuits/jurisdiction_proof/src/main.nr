// jurisdiction_proof
//
// Proves "my country of residence is NOT in the restricted list" without
// revealing which country it is, bound to a commitment a trusted issuer signed
// (secp256k1 ECDSA, in-circuit). Country codes are ISO 3166-1 numeric
// (US=840, IR=364, KP=408); unused slots in the restricted list are 0.

use dep::credential_lib;

// Fixed at compile time, not passed in. A ZK circuit is a fixed set of
// constraints, so the loop below unrolls into exactly RESTRICTED_LEN
// comparisons that every proof must satisfy. If the list length were a runtime
// value the prover controlled, they could shorten it and skip the entries that
// would have caught them.
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
<<<<<<< HEAD
    nullifier: pub Field,
) {
    // Binds the private country code to the issuer-signed commitment and
    // verifies the issuer's signature in-circuit. circuits/lib/src/lib.nr has the
    // detail. The consequence of losing either constraint is sharper here than
    // elsewhere: without the commitment check a holder could present a genuine
    // signed commitment and separately claim any country, which is exactly the
    // sanctions bypass this circuit exists to prevent.
    // The salt matters more here than in the threshold circuits, too. There are
    // only about 250 ISO 3166-1 numeric codes, so an unsalted commitment could be
    // reversed in a few hundred hashes and the holder's country read straight off
    // the public inputs.
    credential_lib::assert_committed_and_signed(country_code as Field, salt, sig, commitment, issuer_x, issuer_y);

    // Non-membership, proved rather than asserted. `restricted` is public and
    // `country_code` is not, so the contract cannot run this check itself: it
    // never sees the country. Every slot must be compared, because a single
    // skipped entry is a jurisdiction that passes sanctions screening.
    // Two consequences of `restricted` being a prover-supplied public input:
    //   - The contract MUST check the list against its own policy. A prover who
    //     submits an all-zero list produces a perfectly valid proof of nothing.
    //   - Zero padding does double duty. Padding slots are 0, so the loop also
    //     enforces `country_code != 0`, rejecting a credential with an empty or
    //     unset country. This guard is incidental rather than designed: it holds
    //     only while at least one slot is still padding, and it vanishes the
    //     moment all RESTRICTED_LEN slots carry real codes.
    //     Whoever fills the last slot must add an explicit
    //     `assert(country_code != 0)` here in the same change. It has to go here
    //     and nowhere else, because `country_code` is a private input that never
    //     reaches the verifier, so the contract cannot make up for its loss.
    for i in 0..RESTRICTED_LEN {
        assert(country_code != restricted[i]);
    }
    assert(Poseidon2::hash([salt, context_id], 2) == nullifier);
=======
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
>>>>>>> b2864dac3a2dd97dbc8978c850eefc88f3e86599
}