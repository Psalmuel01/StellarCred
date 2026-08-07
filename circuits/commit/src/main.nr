// commit
//
// Helper circuit used only by the issuer to compute a credential commitment:
// commitment = Poseidon2([value, salt], 2). Executed (witness only) in the
// browser to derive the commitment, never proven. Every credential circuit
// binds to a commitment of this exact shape, so the issuer can use this one
// helper for all credential types.

use dep::poseidon::poseidon2::Poseidon2;

fn main(value: Field, salt: Field) -> pub Field {
    Poseidon2::hash([value, salt], 2)
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package commit
// The commit circuit has no signature; all tests are fully deterministic.

// Poseidon2 is deterministic: same inputs must always yield the same commitment.
#[test]
fn test_commitment_is_deterministic() {
    let c1 = main(42, 99);
    let c2 = main(42, 99);
    assert(c1 == c2);
}

// Different values must produce different commitments (collision-resistance).
#[test]
fn test_different_values_produce_different_commitments() {
    let c1 = main(1, 0);
    let c2 = main(2, 0);
    assert(c1 != c2);
}

// Different salts must produce different commitments (binding).
#[test]
fn test_different_salts_produce_different_commitments() {
    let c1 = main(42, 1);
    let c2 = main(42, 2);
    assert(c1 != c2);
}

// Commitment for (0, 0) must be non-zero (Poseidon2 output is never zero for
// any input in the BN254 scalar field under the standard parameters).
#[test]
fn test_zero_inputs_non_zero_commitment() {
    let c = main(0, 0);
    assert(c != 0);
}

// Large field-element values are accepted without overflow.
#[test]
fn test_large_inputs_accepted() {
    // max u64 cast to Field
    let big: Field = 0xffffffffffffffff;
    let c = main(big, big);
    assert(c != 0);
}
