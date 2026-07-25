// jurisdiction_proof
//
// Proves "my country of residence is NOT in the restricted list" without
// revealing which country it is, bound to a commitment a trusted issuer signed
// (secp256k1 ECDSA, in-circuit). Country codes are ISO 3166-1 numeric
// (US=840, IR=364, KP=408); unused slots in the restricted list are 0.

use dep::stellarcred_circuit_lib::{assert_commitment, assert_ecdsa};

global RESTRICTED_LEN: u32 = 8;

fn main(
    // private
    country_code: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    restricted: pub [u64; RESTRICTED_LEN],
) {
    assert_commitment(country_code as Field, salt, commitment);
    assert_ecdsa(issuer_x, issuer_y, sig, commitment);
    for i in 0..RESTRICTED_LEN {
        assert(country_code != restricted[i]);
    }
}

#[test]
fn test_valid() {
    let country_code = 566;
    let salt = 77;
    let commitment = 2680082864261061846279169728698682008067918015162700438905450749141437749581;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let sig: [u8; 64] = [180, 213, 195, 188, 87, 181, 74, 213, 182, 243, 80, 33, 194, 38, 78, 47, 49, 33, 175, 25, 192, 17, 226, 3, 82, 68, 206, 188, 204, 137, 2, 105, 78, 60, 196, 3, 7, 153, 240, 241, 15, 36, 80, 64, 239, 51, 29, 28, 170, 207, 254, 199, 132, 198, 222, 211, 214, 11, 95, 85, 236, 187, 146, 169];
    
    main(
        country_code,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        restricted,
    );
}

#[test(should_fail)]
fn test_wrong_commitment() {
    let country_code = 566;
    let salt = 77;
    let commitment = 123;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let sig: [u8; 64] = [180, 213, 195, 188, 87, 181, 74, 213, 182, 243, 80, 33, 194, 38, 78, 47, 49, 33, 175, 25, 192, 17, 226, 3, 82, 68, 206, 188, 204, 137, 2, 105, 78, 60, 196, 3, 7, 153, 240, 241, 15, 36, 80, 64, 239, 51, 29, 28, 170, 207, 254, 199, 132, 198, 222, 211, 214, 11, 95, 85, 236, 187, 146, 169];
    
    main(
        country_code,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        restricted,
    );
}

#[test(should_fail)]
fn test_restricted_fail() {
    let country_code = 566;
    let salt = 77;
    let commitment = 2680082864261061846279169728698682008067918015162700438905450749141437749581;
    let restricted: [u64; 8] = [840, 364, 408, 566, 0, 0, 0, 0]; // 566 is restricted
    let sig: [u8; 64] = [180, 213, 195, 188, 87, 181, 74, 213, 182, 243, 80, 33, 194, 38, 78, 47, 49, 33, 175, 25, 192, 17, 226, 3, 82, 68, 206, 188, 204, 137, 2, 105, 78, 60, 196, 3, 7, 153, 240, 241, 15, 36, 80, 64, 239, 51, 29, 28, 170, 207, 254, 199, 132, 198, 222, 211, 214, 11, 95, 85, 236, 187, 146, 169];
    
    main(
        country_code,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        restricted,
    );
}

#[test(should_fail)]
fn test_wrong_signature() {
    let country_code = 566;
    let salt = 77;
    let commitment = 2680082864261061846279169728698682008067918015162700438905450749141437749581;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let mut sig: [u8; 64] = [180, 213, 195, 188, 87, 181, 74, 213, 182, 243, 80, 33, 194, 38, 78, 47, 49, 33, 175, 25, 192, 17, 226, 3, 82, 68, 206, 188, 204, 137, 2, 105, 78, 60, 196, 3, 7, 153, 240, 241, 15, 36, 80, 64, 239, 51, 29, 28, 170, 207, 254, 199, 132, 198, 222, 211, 214, 11, 95, 85, 236, 187, 146, 169];
    sig[0] = 0;
    
    main(
        country_code,
        salt,
        sig,
        commitment,
        stellarcred_circuit_lib::test_helpers::issuer_x(),
        stellarcred_circuit_lib::test_helpers::issuer_y(),
        restricted,
    );
}
