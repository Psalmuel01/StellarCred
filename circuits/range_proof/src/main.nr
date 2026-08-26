// range_proof
//
// Proves "min <= value <= max" without revealing the value, bound to a
// commitment a trusted issuer signed (secp256k1 ECDSA, checked in-circuit).

use dep::poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256k1::verify_signature;

fn main(
    // private
    value: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    min: pub u64,
    max: pub u64,
) {
    // Blocks the degenerate zero-salt case; see circuits/lib/src/lib.nr for
    // the full rationale on why salt must be non-trivial.
    assert(salt != 0);
    assert(Poseidon2::hash([value as Field, salt], 2) == commitment);
    let z: [u8; 32] = commitment.to_be_bytes();
    assert(verify_signature(issuer_x, issuer_y, sig, z));
    assert(value >= min);
    assert(value <= max);
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package range_proof

// A zero salt must be rejected outright, before any other constraint is even
// reached - it makes the commitment a brute-forceable hash of `value`.
#[test(should_fail)]
fn test_zero_salt_rejected() {
    let zero_sig: [u8; 64] = [0; 64];
    let zero_x: [u8; 32] = [0; 32];
    let zero_y: [u8; 32] = [0; 32];
    main(50, 0, zero_sig, 0, zero_x, zero_y, 0, 100);
}
