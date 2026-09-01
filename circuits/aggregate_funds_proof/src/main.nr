// Aggregate Funds Proof Circuit
//
// Proves that the sum of balances from multiple linked accounts (e.g. several
// Plaid items) meets or exceeds a threshold, without revealing individual
// account balances. The issuer attests to the aggregated sum server-side by
// signing the commitment, keeping identity/source data out of the circuit.
//
// Private inputs:
//   balances[i] — individual account balances (u64, zero-padded beyond actual sources)
//   salt        — random field element for commitment hiding
//   signature   — 64-byte secp256k1 ECDSA signature (r ‖ s) over the commitment
//
// Public inputs:
//   commitment  — Poseidon2([aggregate_balance, salt], 2)
//   issuer_x    — issuer secp256k1 public key X coordinate
//   issuer_y    — issuer secp256k1 public key Y coordinate
//   threshold   — minimum required aggregate balance
//
// The commitment binds the prover to the exact aggregate balance, preventing
// selective disclosure or re-aggregation after signing. Individual source
// identities (account IDs, Plaid item tokens) remain server-side.

use dep::std;

fn main(
    // --- Private inputs ---
    balances: [u64; 8],
    salt: Field,
    signature: [u8; 64],
    // --- Public inputs ---
    pub commitment: Field,
    pub issuer_x: [u8; 32],
    pub issuer_y: [u8; 32],
    pub threshold: u64,
) {
    // 1. Compute aggregate balance across all linked accounts
    //    (unrolled loop — Noir does not support dynamic iteration)
    let mut aggregate_balance: u64 = 0;
    aggregate_balance = aggregate_balance + balances[0];
    aggregate_balance = aggregate_balance + balances[1];
    aggregate_balance = aggregate_balance + balances[2];
    aggregate_balance = aggregate_balance + balances[3];
    aggregate_balance = aggregate_balance + balances[4];
    aggregate_balance = aggregate_balance + balances[5];
    aggregate_balance = aggregate_balance + balances[6];
    aggregate_balance = aggregate_balance + balances[7];

    // 2. Verify the issuer-signed commitment matches the computed aggregate
    let computed_commitment = std::hash::poseidon2::Poseidon2::hash(
        [aggregate_balance as Field, salt],
        2,
    );
    assert(computed_commitment == commitment);

    // 3. Verify the issuer's secp256k1 ECDSA signature over the commitment
    //    prehash: false — the circuit expects the raw 32-byte commitment as
    //    the message digest (matching Noir's convention, not SHA-256 prehash)
    let valid_signature = std::ecdsa_secp256k1::verify_signature(
        issuer_x,
        issuer_y,
        commitment.to_be_bytes(),
        signature,
    );
    assert(valid_signature);

    // 4. Prove the aggregate balance meets or exceeds the threshold
    //    Individual balances remain fully private — only the sum is committed
    assert(aggregate_balance >= threshold);
}
