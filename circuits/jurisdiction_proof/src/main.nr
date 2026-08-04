// jurisdiction_proof
//
// Proves jurisdiction eligibility bound to a commitment a trusted issuer signed
// (secp256k1 ECDSA, in-circuit). Country codes are ISO 3166-1 numeric
// (US=840, IR=364, KP=408); unused slots in the list are 0.
//
// mode = 0 (denylist): proves "my country is NOT in the restricted list"
// mode = 1 (allowlist): proves "my country IS in the allowed list"

use dep::credential_lib;
use dep::poseidon::poseidon2::Poseidon2;

// Fixed at compile time, not passed in. A ZK circuit is a fixed set of
// constraints, so the loop below unrolls into exactly RESTRICTED_LEN
// comparisons that every proof must satisfy. If the list length were a runtime
// value the prover controlled, they could shorten it and skip the entries that
// would have caught them.
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
    mode: pub u64,
) {
    credential_lib::assert_committed_and_signed(country_code as Field, salt, sig, commitment, issuer_x, issuer_y);

    if mode == 0 {
        for i in 0..RESTRICTED_LEN {
            assert(country_code != restricted[i]);
        }
    } else {
        assert(mode == 1);
        assert(country_code != 0);
        let mut found: bool = false;
        for i in 0..RESTRICTED_LEN {
            if restricted[i] != 0 {
                if country_code == restricted[i] {
                    found = true;
                }
            }
        }
        assert(found);
    }
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package jurisdiction_proof

global JUR_ZERO_SIG: [u8; 64] = [0; 64];
global JUR_ZERO_X: [u8; 32]   = [0; 32];
global JUR_ZERO_Y: [u8; 32]   = [0; 32];

#[test(should_fail)]
fn test_wrong_commitment_rejected() {
    let restricted: [u64; 8] = [0; 8];
    main(566, 0xabcd, JUR_ZERO_SIG, 0x1, JUR_ZERO_X, JUR_ZERO_Y, restricted, 0);
}

#[test(should_fail)]
fn test_restricted_country_rejected() {
    let country_code: u64 = 840;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let bad_commitment = 0x2;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 0);
}

#[test(should_fail)]
fn test_restricted_country_mid_list_rejected() {
    let country_code: u64 = 408;
    let restricted: [u64; 8] = [0, 0, 0, 408, 0, 0, 0, 0];
    let bad_commitment = 0x3;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 0);
}

#[test(should_fail)]
fn test_salt_mismatch_rejected() {
    let cc: u64 = 566;
    let real_salt: Field = 0x1234;
    let wrong_salt: Field = 0x5678;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let commitment = Poseidon2::hash([cc as Field, real_salt], 2);
    main(cc, wrong_salt, JUR_ZERO_SIG, commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 0);
}

#[test(should_fail)]
fn test_country_code_zero_rejected() {
    let country_code: u64 = 0;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let bad_commitment = 0x4;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 0);
}

#[test(should_fail)]
fn test_all_slots_filled_non_matching_rejected() {
    let country_code: u64 = 840;
    let restricted: [u64; 8] = [840, 364, 408, 276, 356, 392, 410, 528];
    let bad_commitment = 0x5;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 0);
}

#[test(should_fail)]
fn test_allowlist_country_allowed() {
    let country_code: u64 = 840;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let bad_commitment = 0x7;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 1);
}

#[test(should_fail)]
fn test_allowlist_country_rejected() {
    let country_code: u64 = 276;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let bad_commitment = 0x6;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 1);
}

#[test(should_fail)]
fn test_invalid_mode_rejected() {
    let country_code: u64 = 566;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let commitment = Poseidon2::hash([country_code as Field, 0x1], 2);
    main(country_code, 0x1, JUR_ZERO_SIG, commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted, 2);
}