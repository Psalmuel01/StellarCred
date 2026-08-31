// accreditation_proof
//
// Proves "my net worth is at least `threshold`" without revealing the figure,
// bound to a commitment a trusted issuer signed (secp256k1 ECDSA, in-circuit).
// Unlocks regulated DeFi and private-market access on Stellar.

use dep::credential_lib;
use dep::poseidon::poseidon2::Poseidon2;

fn main(
    // private
    net_worth: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    threshold: pub u64,
) {
    assert(salt != 0);

    credential_lib::assert_committed_and_signed(
        net_worth as Field,
        salt,
        sig,
        commitment,
        issuer_x,
        issuer_y
    );

    assert(net_worth >= threshold);
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package accreditation_proof

global ACC_ZERO_SIG: [u8; 64] = [0; 64];
global ACC_ZERO_X: [u8; 32]   = [0; 32];
global ACC_ZERO_Y: [u8; 32]   = [0; 32];

#[test(should_fail)]
fn test_wrong_commitment_rejected() {
    main(1500000, 0xbeef, ACC_ZERO_SIG, 0x1, ACC_ZERO_X, ACC_ZERO_Y, 1000000);
}

// net_worth < threshold: below accreditation threshold.
#[test(should_fail)]
fn test_net_worth_below_threshold_rejected() {
    let net_worth: u64 = 999999;
    let threshold: u64 = 1000000;
    let bad_commitment = 0x2;
    main(net_worth, 0x1, ACC_ZERO_SIG, bad_commitment, ACC_ZERO_X, ACC_ZERO_Y, threshold);
}

// Off-by-one: one unit below the accreditation threshold.
#[test(should_fail)]
fn test_net_worth_one_below_threshold_rejected() {
    let net_worth: u64 = 1499999;
    let threshold: u64 = 1500000;
    let bad_commitment = 0x3;
    main(net_worth, 0x1, ACC_ZERO_SIG, bad_commitment, ACC_ZERO_X, ACC_ZERO_Y, threshold);
}

// salt mismatch.
#[test(should_fail)]
fn test_salt_mismatch_rejected() {
    let nw: u64 = 2000000;
    let real_salt: Field  = 0x7777;
    let wrong_salt: Field = 0x8888;
    let commitment = Poseidon2::hash([nw as Field, real_salt], 2);
    main(nw, wrong_salt, ACC_ZERO_SIG, commitment, ACC_ZERO_X, ACC_ZERO_Y, 1000000);
}
