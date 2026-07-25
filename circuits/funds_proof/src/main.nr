// funds_proof
//
// Proves "my account balance is at least `threshold`" without revealing the
// figure, bound to a commitment a trusted issuer signed (secp256k1 ECDSA,
// in-circuit). The balance is an integer (e.g. USD cents or whole dollars).

use dep::stellarcred_circuit_lib::{assert_commitment, assert_ecdsa, assert_threshold};

fn main(
    // private
    balance: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    threshold: pub u64,
) {
    assert_commitment(balance as Field, salt, commitment);
    assert_ecdsa(issuer_x, issuer_y, sig, commitment);
    assert_threshold(balance, threshold);
}

#[test]
fn test_valid() {
    let balance = 250000;
    let salt = 99;
    let commitment = 7909036842638164721995367664839344787658570241219533375402692686111964679620;
    let threshold = 200000;
    let sig: [u8; 64] = [25, 52, 74, 44, 162, 253, 1, 253, 112, 196, 236, 188, 35, 75, 121, 160, 4, 143, 109, 4, 187, 137, 250, 180, 1, 177, 15, 12, 65, 51, 51, 188, 43, 24, 138, 8, 10, 95, 133, 253, 35, 39, 95, 182, 114, 135, 97, 208, 218, 188, 179, 47, 11, 162, 166, 209, 235, 204, 15, 144, 35, 72, 121, 54];
    
    main(
        balance,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        threshold,
    );
}

#[test(should_fail)]
fn test_wrong_commitment() {
    let balance = 250000;
    let salt = 99;
    let commitment = 123;
    let threshold = 200000;
    let sig: [u8; 64] = [25, 52, 74, 44, 162, 253, 1, 253, 112, 196, 236, 188, 35, 75, 121, 160, 4, 143, 109, 4, 187, 137, 250, 180, 1, 177, 15, 12, 65, 51, 51, 188, 43, 24, 138, 8, 10, 95, 133, 253, 35, 39, 95, 182, 114, 135, 97, 208, 218, 188, 179, 47, 11, 162, 166, 209, 235, 204, 15, 144, 35, 72, 121, 54];
    
    main(
        balance,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        threshold,
    );
}

#[test(should_fail)]
fn test_boundary_fail() {
    let balance = 250000;
    let salt = 99;
    let commitment = 7909036842638164721995367664839344787658570241219533375402692686111964679620;
    let threshold = 250001; // should fail
    let sig: [u8; 64] = [25, 52, 74, 44, 162, 253, 1, 253, 112, 196, 236, 188, 35, 75, 121, 160, 4, 143, 109, 4, 187, 137, 250, 180, 1, 177, 15, 12, 65, 51, 51, 188, 43, 24, 138, 8, 10, 95, 133, 253, 35, 39, 95, 182, 114, 135, 97, 208, 218, 188, 179, 47, 11, 162, 166, 209, 235, 204, 15, 144, 35, 72, 121, 54];
    
    main(
        balance,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        threshold,
    );
}

#[test(should_fail)]
fn test_wrong_signature() {
    let balance = 250000;
    let salt = 99;
    let commitment = 7909036842638164721995367664839344787658570241219533375402692686111964679620;
    let threshold = 200000;
    let mut sig: [u8; 64] = [25, 52, 74, 44, 162, 253, 1, 253, 112, 196, 236, 188, 35, 75, 121, 160, 4, 143, 109, 4, 187, 137, 250, 180, 1, 177, 15, 12, 65, 51, 51, 188, 43, 24, 138, 8, 10, 95, 133, 253, 35, 39, 95, 182, 114, 135, 97, 208, 218, 188, 179, 47, 11, 162, 166, 209, 235, 204, 15, 144, 35, 72, 121, 54];
    sig[0] = 0;
    
    main(
        balance,
        salt,
        sig,
        commitment,
        stellarcred_circuit_lib::test_helpers::issuer_x(),
        stellarcred_circuit_lib::test_helpers::issuer_y(),
        threshold,
    );
}
