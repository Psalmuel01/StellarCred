use dep::poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256k1::verify_signature;

pub fn assert_commitment(secret: Field, salt: Field, expected: Field) {
    assert(Poseidon2::hash([secret, salt], 2) == expected);
}

pub fn assert_ecdsa(issuer_x: [u8; 32], issuer_y: [u8; 32], sig: [u8; 64], commitment: Field) {
    let z: [u8; 32] = commitment.to_be_bytes();
    assert(verify_signature(issuer_x, issuer_y, sig, z));
}

pub fn assert_threshold(value: u64, threshold: u64) {
    assert(value >= threshold);
}

// Common test data
pub mod test_helpers {
    pub fn issuer_x() -> [u8; 32] {
        [62, 72, 233, 139, 1, 120, 194, 91, 166, 62, 68, 43, 79, 232, 156, 91, 89, 165, 40, 83, 125, 90, 232, 8, 228, 119, 17, 59, 196, 72, 32, 251]
    }

    pub fn issuer_y() -> [u8; 32] {
        [7, 217, 196, 88, 103, 117, 28, 168, 249, 234, 195, 188, 47, 23, 13, 0, 168, 88, 125, 213, 56, 190, 32, 144, 120, 211, 244, 170, 55, 97, 227, 101]
    }
}
