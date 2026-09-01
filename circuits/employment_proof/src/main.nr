// employment_proof
//
// Proves "I am employed" (and optionally at seniority >= min_seniority)
// without revealing the employer or exact role, bound to a commitment a
// trusted issuer (the employer) signed (secp256k1 ECDSA, in-circuit).
// Unlocks income-linked lending, professional gating, and DAO contributor
// verification.
//
// The commitment is Poseidon2::hash([employment_status, seniority, salt], 3),
// so the issuer's signature binds BOTH the "is employed" tag AND the
// holder's specific tenure. The min_seniority public input is just the
// threshold the verifier asks about; it is not part of the commitment.

use dep::poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256k1::verify_signature;

fn main(
    // private
    employment_status: u64,
    seniority: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    min_seniority: pub u64,
) {
    // Blocks the degenerate zero-salt case; see circuits/lib/src/lib.nr for
    // the full rationale on why salt must be non-trivial.
    assert(salt != 0);
    // The issuer's signature covers a commitment that includes both the
    // employment status AND the holder's tenure, so the seniority claim is
    // backed by the issuer, not self-asserted.
    assert(
        Poseidon2::hash(
            [employment_status as Field, seniority as Field, salt],
            3,
        ) == commitment,
    );
    let z: [u8; 32] = commitment.to_be_bytes();
    assert(verify_signature(issuer_x, issuer_y, sig, z));
    // The status tag must be > 0 (i.e. the holder is "employed"); issuers are
    // expected to only sign non-zero tags, but the constraint also defends
    // against forged zero-tag credentials.
    assert(employment_status != 0);
    assert(seniority >= min_seniority);
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package employment_proof

// A zero salt must be rejected outright, before any other constraint is even
// reached - it makes the 3-arity commitment brute-forceable given the small
// (status, seniority) domain.
#[test(should_fail)]
fn test_zero_salt_rejected() {
    let zero_sig: [u8; 64] = [0; 64];
    let zero_x: [u8; 32] = [0; 32];
    let zero_y: [u8; 32] = [0; 32];
    main(1, 5, 0, zero_sig, 0, zero_x, zero_y, 0);
}
