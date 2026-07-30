// funds_proof
//
// Proves "my account balance is at least `threshold`" without revealing the
// figure, bound to a commitment a trusted issuer signed (secp256k1 ECDSA,
// in-circuit). The balance is an integer (e.g. USD cents or whole dollars).

use dep::credential_lib;

fn main(
    // private
    //
    // `balance` is u64 rather than Field on purpose: `>=` on Field has no
    // meaningful ordering over BN254, and a prover could choose a value that
    // wraps the modulus to compare however they needed. u64 is a bounded integer
    // whose width the proving system range-constrains, so the comparison below
    // means what it reads as. It also caps the balance near 1.8e19, comfortably
    // above any real figure in cents.
    balance: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    threshold: pub u64,
) {
    // Binds the private balance to the issuer-signed commitment and verifies the
    // issuer's signature in-circuit. See circuits/lib/src/lib.nr for the detail;
    // in short, without the commitment check the threshold assertion below would
    // be about an unrelated balance, and without the in-circuit signature check
    // a holder could commit to any balance and sign it with their own key.
    // The `as Field` cast is a lossless widening, so it cannot map two distinct
    // balances to the same commitment.
    credential_lib::assert_committed_and_signed(balance as Field, salt, sig, commitment, issuer_x, issuer_y);

    // The claim itself, proved rather than asserted. `threshold` is a public
    // input chosen by the prover and carries no weight by itself; this constraint
    // is what ties it to the signed private balance. It cannot move on-chain
    // because the contract never sees `balance`, so dropping it lets a holder
    // submit whatever threshold they want and still verify.
    // The contract must still confirm the `threshold` in the public inputs is the
    // figure its policy demands.
    // Worth noting for this credential type specifically: a balance is a
    // point-in-time fact and this circuit carries no timestamp, so the proof says
    // nothing about when the balance held. Freshness has to come from issuance
    // policy and the contract's expiry handling, not from here.
    assert(balance >= threshold);
}
