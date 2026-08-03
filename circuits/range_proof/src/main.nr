// range_proof
//
// Proves "min <= value <= max" without revealing the value, bound to a
// commitment a trusted issuer signed (secp256k1 ECDSA, checked in-circuit).

use dep::poseidon::poseidon2::Poseidon2;
use std::ecdsa_secp256k1::verify_signature;

fn main(
    // private
    value: u64,
    salt: Field,
    sig: [u8; 64],
    // public
    commitment: pub Field,
    issuer_x: pub [u8; 32],
    issuer_y: pub [u8; 32],
    min: pub u64,
    max: pub u64,
) {
    assert(Poseidon2::hash([value as Field, salt], 2) == commitment);
    let z: [u8; 32] = commitment.to_be_bytes();
    assert(verify_signature(issuer_x, issuer_y, sig, z));
    assert(value >= min);
    assert(value <= max);
}
