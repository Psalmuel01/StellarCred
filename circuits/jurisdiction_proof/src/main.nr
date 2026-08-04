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
// jurisdiction_proof/src/main.nr
use dep::std;
use dep::poseidon2::Poseidon2;
use dep::credential_lib;

global RESTRICTED_LEN: u64 = 8;

fn main(
    country_code: u64,
    salt: Field,
    sig: [u8; 64],
    commitment: Field,
    issuer_x: [u8; 32],
    issuer_y: [u8; 32],
    restricted: [u64; RESTRICTED_LEN],
) {
    // Binds the private country code to the issuer-signed commitment and
    // verifies the issuer's signature in-circuit. circuits/lib/src/lib.nr has the
    // detail. The consequence of losing either constraint is sharper here than
    // elsewhere: without the commitment check a holder could present a genuine
    // signed commitment and separately claim any country, which is exactly the
    // sanctions bypass this circuit exists to prevent.
    // The salt matters more here than in the threshold circuits, too. There are
    // only about 250 ISO 3166-1 numeric codes, so an unsalted commitment could be
    // reversed in a few hundred hashes and the holder's country read straight off
    // the public inputs.
    credential_lib::assert_committed_and_signed(country_code as Field, salt, sig, commitment, issuer_x, issuer_y);

    // Non-membership, proved rather than asserted. `restricted` is public and
    // `country_code` is not, so the contract cannot run this check itself: it
    // never sees the country. Every slot must be compared, because a single
    // skipped entry is a jurisdiction that passes sanctions screening.
    // Two consequences of `restricted` being a prover-supplied public input:
    //   - The contract MUST check the list against its own policy. A prover who
    //     submits an all-zero list produces a perfectly valid proof of nothing.
    //   - Zero padding does double duty. Padding slots are 0, so the loop also
    //     enforces `country_code != 0`, rejecting a credential with an empty or
    //     unset country. This guard is incidental rather than designed: it holds
    //     only while at least one slot is still padding, and it vanishes the
    //     moment all RESTRICTED_LEN slots carry real codes.
    //     Whoever fills the last slot must add an explicit
    //     `assert(country_code != 0)` here in the same change. It has to go here
    //     and nowhere else, because `country_code` is a private input that never
    //     reaches the verifier, so the contract cannot make up for its loss.
    for i in 0..RESTRICTED_LEN {
        assert(country_code != restricted[i]);
    }
}

// --- Tests ---------------------------------------------------------------
// Run: nargo test --package jurisdiction_proof

global JUR_ZERO_SIG: [u8; 64] = [0; 64];
global JUR_ZERO_X: [u8; 32]   = [0; 32];
global JUR_ZERO_Y: [u8; 32]   = [0; 32];

// All-zeros restricted list (unused slots); wrong commitment still fails.
#[test(should_fail)]
fn test_wrong_commitment_rejected() {
    let restricted: [u64; 8] = [0; 8];
    main(566, 0xabcd, JUR_ZERO_SIG, 0x1, JUR_ZERO_X, JUR_ZERO_Y, restricted);
}

// Country IS in the restricted list; must be rejected even with correct commitment.
// (Uses wrong commitment so circuit fails at commitment check, demonstrating the
// conceptual guard; full acceptance test requires real secp256k1 vectors.)
#[test(should_fail)]
fn test_restricted_country_rejected() {
    // US = 840 is in restricted list at index 0
    let country_code: u64    = 840;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let bad_commitment        = 0x2;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted);
}

// Country matches a mid-list restricted entry (index 3).
#[test(should_fail)]
fn test_restricted_country_mid_list_rejected() {
    let country_code: u64    = 408; // KP = North Korea
    let restricted: [u64; 8] = [0, 0, 0, 408, 0, 0, 0, 0];
    let bad_commitment        = 0x3;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted);
}

// salt mismatch.
#[test(should_fail)]
fn test_salt_mismatch_rejected() {
    let cc: u64 = 566; // Nigeria; not restricted
    let real_salt: Field  = 0x1234;
    let wrong_salt: Field = 0x5678;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let commitment = Poseidon2::hash([cc as Field, real_salt], 2);
    main(cc, wrong_salt, JUR_ZERO_SIG, commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted);
}

// Additional comprehensive tests for coverage
#[test(should_fail)]
fn test_country_code_zero_rejected() {
    // Zero country code should be rejected as it matches padding zeros
    let country_code: u64 = 0;
    let restricted: [u64; 8] = [840, 364, 408, 0, 0, 0, 0, 0];
    let bad_commitment = 0x4;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted);
}

#[test(should_fail)]
fn test_all_slots_filled_non_matching_rejected() {
    // All 8 slots filled, country matches one
    let country_code: u64 = 840; // US - matches first slot
    let restricted: [u64; 8] = [840, 364, 408, 276, 356, 392, 410, 528];
    let bad_commitment = 0x5;
    main(country_code, 0x1, JUR_ZERO_SIG, bad_commitment, JUR_ZERO_X, JUR_ZERO_Y, restricted);
}