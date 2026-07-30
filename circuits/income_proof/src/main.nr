// income_proof
//
// Proves "my income is at least `threshold`" without revealing the figure,
// bound to a commitment a trusted issuer signed (secp256k1 ECDSA, in-circuit).

use dep::credential_lib;

fn main(
    // private
    //
    // `income` is u64, not Field, and that is a security choice rather than a
    // stylistic one: `>=` on Field has no meaningful ordering over BN254, so a
    // prover could pick a value that wraps the modulus and compares however they
    // needed it to. u64 is a genuine bounded integer whose width the proving
    // system range-constrains, which is what makes the comparison below mean
    // what it reads as.
    income: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    threshold: pub u64,
) {
    // Binds the private income to the issuer-signed commitment and verifies the
    // issuer's signature in-circuit. circuits/lib/src/lib.nr covers what each
    // constraint prevents; briefly, without the commitment check the threshold
    // assertion below would be a statement about a number no issuer attested,
    // and without the in-circuit signature check a holder could commit to an
    // income of their choosing and sign it with their own key.
    // The `as Field` cast is a lossless widening, so it cannot alias two
    // different incomes onto the same commitment.
    credential_lib::assert_committed_and_signed(income as Field, salt, sig, commitment, issuer_x, issuer_y);

    // The claim itself, proved rather than asserted. `threshold` is a public
    // input the prover chooses, so on its own it is an unbacked assertion; this
    // constraint is what binds it to the signed private income. It cannot be
    // enforced on-chain because the contract never sees `income`, so without it
    // a holder submits whatever threshold they want and still verifies.
    // The contract remains responsible for confirming that the `threshold` in
    // the public inputs is the figure its policy actually requires. The circuit
    // proves the relation; it cannot know the policy.
    assert(income >= threshold);
}
