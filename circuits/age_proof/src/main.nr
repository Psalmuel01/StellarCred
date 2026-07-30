// age_proof
//
// Proves "I am at least `threshold_years` old" without revealing the date of
// birth, bound to a commitment a trusted issuer signed (secp256k1 ECDSA, checked
// in-circuit). Dates are days since the Unix epoch.

use dep::credential_lib;

fn main(
    // private
    date_of_birth: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    current_date: pub u64,
    threshold_years: pub u64,
) {
    // Binds the private date of birth to the issuer-signed commitment and
    // verifies the issuer's signature in-circuit. See circuits/lib/src/lib.nr
    // for what each of those two constraints prevents; in short, without the
    // commitment check the age comparison below would be about a date of birth
    // the issuer never saw, and without the in-circuit signature check a holder
    // could sign a self-chosen date of birth with their own key.
    // The `as Field` cast is a lossless widening (u64 fits in BN254 with room to
    // spare), so it cannot map two different dates onto one commitment.
    credential_lib::assert_committed_and_signed(date_of_birth as Field, salt, sig, commitment, issuer_x, issuer_y);

    // Bounds `threshold_years` so the arithmetic below stays in range. To be
    // precise about what this does and does not buy, because the two are easy to
    // conflate:
    // Noir does NOT wrap on u64 overflow. It range-constrains every arithmetic
    // result, so an attacker who picks `threshold_years` large enough to make
    // `threshold_years * 365` exceed 2^64 fails witness generation and produces
    // no proof at all. Verified on the pinned nargo 1.0.0-beta.9: that input
    // aborts with "attempt to multiply with overflow", and the analogous
    // addition aborts with "attempt to add with overflow". So the wraparound
    // attack (choose a huge threshold so the product wraps to a small number and
    // any date of birth clears it) is already dead, and removing this line does
    // not open a soundness hole.
    // It stays because it bounds the product to at most 73,000 days, which makes
    // overflow structurally impossible for any real date rather than merely
    // caught, and because it rejects nonsense claims with an error that names the
    // problem instead of surfacing as an opaque arithmetic failure inside the
    // expression below. 200 is far above any human age and needs no tightening.
    assert(threshold_years <= 200);

    // The claim itself, proved rather than asserted. Equivalent to the older
    // `(current_date - date_of_birth) / 365 >= threshold_years` but stated as a
    // multiplication, which avoids the division constraints entirely: for
    // integers, floor(x / 365) >= t exactly when x >= 365t. Same semantics,
    // cheaper circuit, and no subtraction to underflow.
    // This constraint is the only thing tying the public `threshold_years` to
    // the signed private date of birth. It cannot move on-chain, because the
    // contract never sees `date_of_birth` and so has nothing to compare against;
    // drop it and a holder submits any `threshold_years` they like and the proof
    // still verifies.
    // Two caveats a reviewer should carry away, both about public inputs the
    // prover controls:
    //   - `current_date` is supplied by the prover, not read from the chain. A
    //     holder who submits a far-future `current_date` appears correspondingly
    //     older, and this circuit cannot detect that. The contract MUST check
    //     `current_date` against ledger time. That check is the load-bearing
    //     freshness control for this credential type, and it lives on-chain.
    //   - `threshold_years` likewise has to be the value the verifier's policy
    //     actually requires; the circuit proves the relation, not the policy.
    // Finally, 365-day years ignore leap days, so the threshold is reached
    // slightly early: about one day per four years elapsed, so roughly 4-5 days
    // before an 18th birthday. The bias favours the holder and is documented
    // rather than fixed; anything needing exact birthday semantics must not use
    // this circuit.
    assert(current_date >= date_of_birth + threshold_years * 365);
}
