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
    Poseidon2::hash([status, seniority, salt], 3)
}
