// kyc_proof
//
// Proves the holder knows the secret behind a KYC credential AND that a trusted
// issuer signed the commitment to it (secp256k1 ECDSA, verified in-circuit).
// Public inputs, in order: commitment, issuer_x, issuer_y, so the contract can
// bind the public key to the registered issuer. The signature and secret stay
// private.

use dep::stellarcred_circuit_lib::{assert_commitment, assert_ecdsa};

fn main(
    secret: Field,
    salt: Field,
    sig: [u8; 64],
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
) {
    assert_commitment(secret, salt, commitment);
    assert_ecdsa(issuer_x, issuer_y, sig, commitment);
}

#[test]
fn test_valid() {
    let secret = 42;
    let salt = 7;
    let commitment = 18356166120002151921584774729377106632571441819529538601699918435761750428058;
    let sig: [u8; 64] = [20, 7, 71, 163, 135, 112, 16, 11, 188, 127, 254, 103, 80, 141, 6, 117, 124, 129, 131, 206, 217, 152, 116, 118, 217, 50, 123, 134, 174, 247, 167, 38, 120, 197, 6, 179, 155, 221, 129, 53, 64, 240, 255, 230, 90, 47, 79, 115, 195, 143, 190, 34, 255, 24, 8, 186, 130, 248, 193, 78, 30, 15, 118, 136];
    
    main(
        secret,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
    );
}

#[test(should_fail)]
fn test_wrong_commitment() {
    let secret = 42;
    let salt = 7;
    let commitment = 12345;
    let sig: [u8; 64] = [20, 7, 71, 163, 135, 112, 16, 11, 188, 127, 254, 103, 80, 141, 6, 117, 124, 129, 131, 206, 217, 152, 116, 118, 217, 50, 123, 134, 174, 247, 167, 38, 120, 197, 6, 179, 155, 221, 129, 53, 64, 240, 255, 230, 90, 47, 79, 115, 195, 143, 190, 34, 255, 24, 8, 186, 130, 248, 193, 78, 30, 15, 118, 136];
    
    main(
        secret,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
    );
}

#[test(should_fail)]
fn test_wrong_signature() {
    let secret = 42;
    let salt = 7;
    let commitment = 18356166120002151921584774729377106632571441819529538601699918435761750428058;
    let mut sig: [u8; 64] = [20, 7, 71, 163, 135, 112, 16, 11, 188, 127, 254, 103, 80, 141, 6, 117, 124, 129, 131, 206, 217, 152, 116, 118, 217, 50, 123, 134, 174, 247, 167, 38, 120, 197, 6, 179, 155, 221, 129, 53, 64, 240, 255, 230, 90, 47, 79, 115, 195, 143, 190, 34, 255, 24, 8, 186, 130, 248, 193, 78, 30, 15, 118, 136];
    sig[0] = 0;
    
    main(
        secret,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
    );
}
