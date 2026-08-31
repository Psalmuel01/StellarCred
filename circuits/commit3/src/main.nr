// commit3
//
// Helper circuit used only by the issuer to compute an employment credential
// commitment of the form:
//   commitment = Poseidon2::hash([status, seniority, salt], 3)
// so the issuer's signature binds both the "is employed" tag AND the
// holder's specific tenure (otherwise a holder could self-select any
// seniority >= min_seniority and satisfy the circuit constraint). Executed
// (witness only) in the browser to derive the commitment; never proven.
//
// Most credential types use the 2-arity `commit` helper instead. This one
// exists solely so employment can commit to two preimage values.

use dep::poseidon::poseidon2::Poseidon2;

fn main(status: Field, seniority: Field, salt: Field) -> pub Field {
    // Defense-in-depth: catch a degenerate zero salt at commitment-computation
    // time (issuance), not just at proof time in employment_proof. See
    // circuits/lib/src/lib.nr for the full rationale.
    assert(salt != 0);
    Poseidon2::hash([status, seniority, salt], 3)
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package commit3

#[test]
fn test_commitment_is_deterministic() {
    let c1 = main(1, 5, 7);
    let c2 = main(1, 5, 7);
    assert(c1 == c2);
}

#[test(should_fail)]
fn test_zero_salt_rejected() {
    let _ = main(1, 5, 0);
}
