// age_proof
//
// Proves "I am at least `threshold_years` old" without revealing the date of
// birth, bound to a commitment a trusted issuer signed (secp256k1 ECDSA, checked
// in-circuit). Dates are days since the Unix epoch.

use dep::stellarcred_circuit_lib::{assert_commitment, assert_ecdsa, assert_threshold};

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
    assert_commitment(date_of_birth as Field, salt, commitment);
    assert_ecdsa(issuer_x, issuer_y, sig, commitment);
    assert(current_date >= date_of_birth);
    let age_years = (current_date - date_of_birth) / 365;
    assert_threshold(age_years, threshold_years);
}

#[test]
fn test_valid() {
    let date_of_birth = 3650;
    let salt = 12345;
    let commitment = 11185694688759005258749044191511340074461101343013798358401867479146160036531;
    let current_date = 20000;
    let threshold_years = 18;
    let sig: [u8; 64] = [6, 105, 8, 213, 3, 158, 238, 245, 119, 101, 102, 155, 46, 22, 172, 87, 38, 148, 247, 73, 236, 31, 63, 131, 118, 151, 67, 188, 119, 51, 198, 25, 123, 53, 204, 249, 188, 186, 132, 223, 10, 143, 113, 160, 33, 167, 46, 176, 255, 56, 190, 210, 121, 163, 161, 185, 239, 161, 229, 62, 250, 49, 216, 164];
    
    main(
        date_of_birth,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        current_date,
        threshold_years,
    );
}

#[test(should_fail)]
fn test_wrong_commitment() {
    let date_of_birth = 3650;
    let salt = 12345;
    let commitment = 123;
    let current_date = 20000;
    let threshold_years = 18;
    let sig: [u8; 64] = [6, 105, 8, 213, 3, 158, 238, 245, 119, 101, 102, 155, 46, 22, 172, 87, 38, 148, 247, 73, 236, 31, 63, 131, 118, 151, 67, 188, 119, 51, 198, 25, 123, 53, 204, 249, 188, 186, 132, 223, 10, 143, 113, 160, 33, 167, 46, 176, 255, 56, 190, 210, 121, 163, 161, 185, 239, 161, 229, 62, 250, 49, 216, 164];
    
    main(
        date_of_birth,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        current_date,
        threshold_years,
    );
}

#[test(should_fail)]
fn test_boundary_fail() {
    let date_of_birth = 3650;
    let salt = 12345;
    let commitment = 11185694688759005258749044191511340074461101343013798358401867479146160036531;
    let current_date = 20000;
    // age = (20000 - 3650) / 365 = 44
    let threshold_years = 45; // should fail
    let sig: [u8; 64] = [6, 105, 8, 213, 3, 158, 238, 245, 119, 101, 102, 155, 46, 22, 172, 87, 38, 148, 247, 73, 236, 31, 63, 131, 118, 151, 67, 188, 119, 51, 198, 25, 123, 53, 204, 249, 188, 186, 132, 223, 10, 143, 113, 160, 33, 167, 46, 176, 255, 56, 190, 210, 121, 163, 161, 185, 239, 161, 229, 62, 250, 49, 216, 164];
    
    main(
        date_of_birth,
        salt,
        sig,
        commitment,
        dep::stellarcred_circuit_lib::test_helpers::issuer_x(),
        dep::stellarcred_circuit_lib::test_helpers::issuer_y(),
        current_date,
        threshold_years,
    );
}

#[test(should_fail)]
fn test_wrong_signature() {
    let date_of_birth = 3650;
    let salt = 12345;
    let commitment = 11185694688759005258749044191511340074461101343013798358401867479146160036531;
    let current_date = 20000;
    let threshold_years = 18;
    let mut sig: [u8; 64] = [6, 105, 8, 213, 3, 158, 238, 245, 119, 101, 102, 155, 46, 22, 172, 87, 38, 148, 247, 73, 236, 31, 63, 131, 118, 151, 67, 188, 119, 51, 198, 25, 123, 53, 204, 249, 188, 186, 132, 223, 10, 143, 113, 160, 33, 167, 46, 176, 255, 56, 190, 210, 121, 163, 161, 185, 239, 161, 229, 62, 250, 49, 216, 164];
    sig[0] = 0;
    
    main(
        date_of_birth,
        salt,
        sig,
        commitment,
        stellarcred_circuit_lib::test_helpers::issuer_x(),
        stellarcred_circuit_lib::test_helpers::issuer_y(),
        current_date,
        threshold_years,
    );
}
