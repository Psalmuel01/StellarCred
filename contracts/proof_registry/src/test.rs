#![cfg(test)]

extern crate std;

use super::*;
use credential_verifier::{CredentialVerifier, CredentialVerifierClient};
use issuer_registry::{IssuerRegistry, IssuerRegistryClient};
use proptest::prelude::*;
use soroban_sdk::{
    symbol_short,
    testutils::{
        storage::Persistent as _, Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke,
    },
    vec, Address, Bytes, BytesN, Env, IntoVal,
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    vec, Address, Bytes, BytesN, Env,
};

// Real UltraHonk artifacts from existing circuits.
const VK: &[u8] = include_bytes!("../../../fixtures/kyc/vk");
const PROOF: &[u8] = include_bytes!("../../../fixtures/kyc/proof");
const PUBLIC_INPUTS: &[u8] = include_bytes!("../../../fixtures/kyc/public_inputs");

const FUNDS_VK: &[u8] = include_bytes!("../../../fixtures/funds/vk");
const FUNDS_PROOF: &[u8] = include_bytes!("../../../fixtures/funds/proof");
const FUNDS_PUBLIC_INPUTS: &[u8] = include_bytes!("../../../fixtures/funds/public_inputs");

const AGE_VK: &[u8] = include_bytes!("../../../fixtures/age/vk");
const AGE_PROOF: &[u8] = include_bytes!("../../../fixtures/age/proof");
const AGE_PUBLIC_INPUTS: &[u8] = include_bytes!("../../../fixtures/age/public_inputs");

// Real N=2 aggregate proof (KYC + age) from the aggregate_proof circuit
const AGGREGATE_VK: &[u8] = include_bytes!("../../../fixtures/aggregate/vk");
const AGGREGATE_PROOF: &[u8] = include_bytes!("../../../fixtures/aggregate/proof");
const AGGREGATE_PUBLIC_INPUTS: &[u8] = include_bytes!("../../../fixtures/aggregate/public_inputs");

// ── Helpers ─────────────────────────────────────────────────────────────────

fn pubkey_from_offset(env: &Env, public_inputs: &[u8], start_field: u32) -> BytesN<64> {
    let mut arr = [0u8; 64];
    for i in 0..64usize {
        arr[i] = public_inputs[(start_field as usize + i) * 32 + 31];
    }
    BytesN::from_array(env, &arr)
}

fn pubkey_from(env: &Env, public_inputs: &[u8]) -> BytesN<64> {
    pubkey_from_offset(env, public_inputs, 1)
}

fn demo_pubkey(env: &Env) -> BytesN<64> {
    pubkey_from(env, PUBLIC_INPUTS)
}

fn u8_slice_to_vec_u32(env: &Env, slice: &[u8]) -> Vec<u32> {
    let mut vec = Vec::new(env);
    for i in (0..slice.len()).step_by(4) {
        if i + 4 <= slice.len() {
            let mut chunk = [0u8; 4];
            chunk.copy_from_slice(&slice[i..i + 4]);
            vec.push_back(u32::from_be_bytes(chunk));
        }
    }
    vec
}

struct Harness {
    registry: ProofRegistryClient<'static>,
    registry_id: Address,
    issuer: Address,
}

fn deploy(env: &Env) -> Harness {
    let admin = Address::generate(env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(env, &ir_id);
    let issuer = Address::generate(env);
    ir.register_issuer(&issuer, &demo_pubkey(env), &vec![env, symbol_short!("kyc")]);

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(env, &v_id).set_vk(
        &symbol_short!("kyc"),
        &1u32,
        &Bytes::from_slice(env, VK),
    );

    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    Harness {
        registry: ProofRegistryClient::new(env, &pr_id),
        registry_id: pr_id,
        issuer,
    }
}

fn submit(env: &Env, h: &Harness, holder: &Address, expiry: u64) {
    h.registry.submit_proof(
        holder,
        &h.issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(env, PROOF),
        &Bytes::from_slice(env, PUBLIC_INPUTS),
        &None,
        &expiry,
    );
}

struct MultiHarness {
    registry: ProofRegistryClient<'static>,
    kyc_issuer: Address,
    funds_issuer: Address,
    age_issuer: Address,
}

fn deploy_multi(env: &Env) -> MultiHarness {
    let admin = Address::generate(env);
    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(env, &ir_id);

    let kyc_issuer = Address::generate(env);
    ir.register_issuer(
        &kyc_issuer,
        &pubkey_from(env, PUBLIC_INPUTS),
        &vec![env, symbol_short!("kyc")],
    );

    let (valid, _at, expiry) = h
        .registry
        .is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(valid);
    assert_eq!(expiry, 1000);
}
    let funds_issuer = Address::generate(env);
    ir.register_issuer(
        &funds_issuer,
        &pubkey_from(env, FUNDS_PUBLIC_INPUTS),
        &vec![env, symbol_short!("funds")],
    );

    let age_issuer = Address::generate(env);
    ir.register_issuer(
        &age_issuer,
        &pubkey_from(env, AGE_PUBLIC_INPUTS),
        &vec![env, symbol_short!("age")],
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    let vc = CredentialVerifierClient::new(env, &v_id);
    vc.set_vk(&symbol_short!("kyc"), &1u32, &Bytes::from_slice(env, VK));
    vc.set_vk(
        &symbol_short!("funds"),
        &1u32,
        &Bytes::from_slice(env, FUNDS_VK),
    );
    vc.set_vk(
        &symbol_short!("age"),
        &1u32,
        &Bytes::from_slice(env, AGE_VK),
    );

    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    MultiHarness {
        registry: ProofRegistryClient::new(env, &pr_id),
        kyc_issuer,
        funds_issuer,
        age_issuer,
    }
}

fn kyc_submission(env: &Env, issuer: &Address, expiry: u64) -> ProofSubmission {
    ProofSubmission {
        credential_type: symbol_short!("kyc"),
        proof: Bytes::from_slice(env, PROOF),
        public_inputs: u8_slice_to_vec_u32(env, PUBLIC_INPUTS),
        issuer_id: issuer.clone(),
        expiry,
        vk_version: None,
    }
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn batch_rejects_past_expiry() {
// ═══════════════════════════════════════════════════════════════════════════════
// Single-proof tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn submit_then_verified() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 9999);

    let (valid, _at, expiry) = h
        .registry
        .is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(valid);
    assert_eq!(expiry, 9999);
}

#[test]
fn submit_sets_ttl_through_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let expiry = 90 * 86_400 + 10;

    submit(&env, &h, &holder, expiry);

    let key = DataKey::Proof(holder, symbol_short!("kyc"));
    let ttl = env.as_contract(&h.registry_id, || env.storage().persistent().get_ttl(&key));
    assert!(ttl >= 90 * DAY_IN_LEDGERS);
    assert!(ttl >= expiry.div_ceil(SECONDS_PER_LEDGER) as u32);
}

#[test]
fn anyone_can_bump_valid_claim() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    h.registry.bump_claim(&holder, &symbol_short!("kyc"));

    let key = DataKey::Proof(holder, symbol_short!("kyc"));
    let ttl = env.as_contract(&h.registry_id, || env.storage().persistent().get_ttl(&key));
    assert!(ttl >= PROOF_TTL);
}

#[test]
fn expires_after_ledger_time_passes() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000); // valid until ts=1000
    submit(&env, &h, &holder, 9999);
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );

    env.ledger().with_mut(|li| li.timestamp = 2000);
    env.ledger().with_mut(|li| li.timestamp = 10000);
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn rejects_wrong_issuer_key() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let issuer = Address::generate(&env);
    IssuerRegistryClient::new(&env, &ir_id).register_issuer(
        &issuer,
        &BytesN::from_array(&env, &[3u8; 64]),
        &vec![&env, symbol_short!("kyc")],
    );
    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("kyc"),
        &1u32,
        &Bytes::from_slice(&env, VK),
    );
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);

    let holder = Address::generate(&env);
    let res = registry.try_submit_proof(
        &holder,
        &issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &9999,
    );
    assert!(res.is_err());
    assert!(
        !registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn rejects_untrusted_issuer() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let stranger = Address::generate(&env);

    let res = h.registry.try_submit_proof(
        &holder,
        &stranger,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &9999,
    );
    assert!(res.is_err());
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn rejects_invalid_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    let mut bad = PROOF.to_vec();
    bad[5000] ^= 0xff;
    let res = h.registry.try_submit_proof(
        &holder,
        &h.issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, &bad),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &9999,
    );
    assert!(res.is_err());
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn unverified_holder_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let stranger = Address::generate(&env);
    assert!(
        !h.registry
            .is_verified(&stranger, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn revoke_clears_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 9999);
    h.registry.revoke_proof(&holder, &symbol_short!("kyc"));
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn issuer_revoke_invalidates_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000);
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &None));

    h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));

    submit(&env, &h, &holder, 9999);
    h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(!h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &None));
    // Expiry data preserved for audit even though proof is no longer valid.
    let (_valid, _at, expiry) = h
        .registry
        .is_verified(&holder, &symbol_short!("kyc"), &None);
    assert_eq!(expiry, 1000);
}

#[test]
fn issuer_revoke_rejects_wrong_issuer() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let stranger = Address::generate(&env);

    submit(&env, &h, &holder, 1000);
    submit(&env, &h, &holder, 9999);
    let res = h
        .registry
        .try_revoke(&stranger, &holder, &symbol_short!("kyc"));
    assert!(res.is_err());
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn issuer_revoke_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    // Assert the submitted event immediately after submit — the snapshot
    // framework drains env.events().all() after each contract invocation.
    submit(&env, &h, &holder, 1000);
    assert_eq!(
        env.events().all().filter_by_contract(&h.registry.address),
        vec![
            &env,
            (
                h.registry.address.clone(),
                (
                    symbol_short!("proof_reg"),
                    symbol_short!("submitted"),
                    symbol_short!("kyc"),
                )
                    .into_val(&env),
                EventProofSubmitted {
                    holder: holder.clone(),
                    issuer: h.issuer.clone(),
                    verified_at: env.ledger().timestamp(),
                    expiry: 1000,
                }
                .into_val(&env),
            ),
        ],
    );

    // Assert the revoked event immediately after revoke.
    h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));
    assert_eq!(
        env.events().all().filter_by_contract(&h.registry.address),
        vec![
            &env,
            (
                h.registry.address.clone(),
                (
                    symbol_short!("proof_reg"),
                    symbol_short!("revoked"),
                    symbol_short!("kyc"),
                )
                    .into_val(&env),
                EventProofRevoked {
                    holder: holder.clone(),
                    issuer: h.issuer.clone(),
                    revoked_at: env.ledger().timestamp(),
                }
                .into_val(&env),
            ),
        ],
    );
}

#[test]
fn pause_blocks_submit_reads_still_work_and_unpause_restores() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000);
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );

    h.registry.pause();
    assert_eq!(
        env.events().all().filter_by_contract(&h.registry.address),
        vec![
            &env,
            (
                h.registry.address.clone(),
                (symbol_short!("proof_reg"), symbol_short!("paused")).into_val(&env),
                EventPaused {
                    admin: h.admin.clone(),
                    paused_at: env.ledger().timestamp(),
                }
                .into_val(&env),
            ),
        ],
    );

    // Reads remain available while paused.
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &None));

    submit(&env, &h, &holder, 9999);
    h.registry.pause();
    let res = h.registry.try_submit_proof(
        &holder,
        &h.issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &9999,
    );
    assert!(res.is_err());
    h.registry.unpause();
    assert_eq!(
        env.events().all().filter_by_contract(&h.registry.address),
        vec![
            &env,
            (
                h.registry.address.clone(),
                (symbol_short!("proof_reg"), symbol_short!("unpaused")).into_val(&env),
                EventUnpaused {
                    admin: h.admin.clone(),
                    unpaused_at: env.ledger().timestamp(),
                }
                .into_val(&env),
            ),
        ],
    );

    h.registry.submit_proof(
        &holder,
        &h.issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &2000,
    );
    let (valid, _at, expiry) = h
        .registry
        .is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(valid);
    assert_eq!(expiry, 2000);
}

#[test]
fn non_admin_cannot_pause() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let res = h.registry.mock_auths(&[]).try_pause();
    assert!(res.is_err());
}

// ── Batch tests ────────────────────────────────────────────────────────────────

#[test]
fn batch_all_pass() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    let submissions = vec![
        &env,
        kyc_submission(&env, &h.kyc_issuer, 9999),
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, FUNDS_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("age"),
            proof: Bytes::from_slice(&env, AGE_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, AGE_PUBLIC_INPUTS),
            issuer_id: h.age_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];

    h.registry.submit_proofs(&holder, &submissions);
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );

    let admin = Address::generate(&env);
    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &demo_pubkey(&env),
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
    );
    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("aggregate"),
        &1u32,
        &Bytes::from_slice(&env, AGGREGATE_VK),
    );
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );
    assert!(
        registry
            .is_verified(&holder2, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        registry
            .is_verified(&holder2, &symbol_short!("age"), &None)
            .0
    );
}

#[test]
fn batch_one_fail_reverts_all() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000);
    // check_claim with no min_threshold should behave like is_verified.
    assert!(h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &None));
}
    let mut bad_funds = FUNDS_PROOF.to_vec();
    bad_funds[5000] ^= 0xff;

    let submissions = vec![
        &env,
        kyc_submission(&env, &h.kyc_issuer, 9999),
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, &bad_funds),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];

    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}

#[test]
fn batch_duplicate_credential_type_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    let sub = kyc_submission(&env, &h.issuer, 9999);
    let submissions = vec![&env, sub.clone(), sub];
    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());
}

#[test]
fn batch_empty_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let submissions: Vec<ProofSubmission> = Vec::new(&env);
    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());
}

#[test]
fn batch_rejects_past_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000);

    // An empty Some([]) list has no members to match against — rejects every
    // issuer, including the one that actually signed the proof.
    let empty: Vec<Address> = Vec::new(&env);
    assert!(!h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &Some(empty),));
    let submissions = vec![&env, kyc_submission(&env, &h.issuer, 0)];
    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());
}

#[test]
fn batch_rejects_over_max_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    let submissions = vec![&env, kyc_submission(&env, &h.issuer, u64::MAX)];
    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());
}

// ── Aggregate proof tests ─────────────────────────────────────────────────────

#[test]
fn aggregate_submits_real_proof_and_stores_claims() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &pubkey_from(&env, FUNDS_PUBLIC_INPUTS),
        &vec![&env, symbol_short!("funds")],
    );
    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("funds"),
        &1u32,
        &Bytes::from_slice(&env, FUNDS_VK),
    );
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);
    let other_issuer = Address::generate(&env);

    registry.submit_proof(
        &holder,
        &issuer,
        &symbol_short!("funds"),
        &Bytes::from_slice(&env, FUNDS_PROOF),
        &Bytes::from_slice(&env, FUNDS_PUBLIC_INPUTS),
        &None,
        &9999,
        &demo_pubkey(&env),
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("funds"),
        &1u32,
        &Bytes::from_slice(&env, FUNDS_VK),
    );
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    registry.submit_proof(
        &holder,
        &issuer,
        &symbol_short!("funds"),
        &Bytes::from_slice(&env, FUNDS_PROOF),
        &Bytes::from_slice(&env, FUNDS_PUBLIC_INPUTS),
        &None,
        &9999,
    );

    // A protocol requiring <= the proved threshold passes.
    assert!(registry.check_claim(&holder, &symbol_short!("funds"), &Some(200_000), &None));
    assert!(registry.check_claim(&holder, &symbol_short!("funds"), &Some(50_000), &None));
    assert!(registry.check_claim(&holder, &symbol_short!("funds"), &None, &None));

    // A protocol requiring MORE than was proved fails.
    assert!(!registry.check_claim(&holder, &symbol_short!("funds"), &Some(250_000), &None));
}

#[test]
fn age_threshold_stored_and_checked() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &pubkey_from(&env, AGE_PUBLIC_INPUTS),
        &vec![&env, symbol_short!("age")],
    );
    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("age"),
        &1u32,
        &Bytes::from_slice(&env, AGE_VK),
    );
        &symbol_short!("aggregate"),
        &1u32,
        &Bytes::from_slice(&env, AGGREGATE_VK),
    );

    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    registry.submit_aggregate_proof(
        &holder,
        &issuer,
        &symbol_short!("age"),
        &Bytes::from_slice(&env, AGE_PROOF),
        &Bytes::from_slice(&env, AGE_PUBLIC_INPUTS),
        &None,
        &9999,
    );

    // Protocols requiring <= 18 pass.
    assert!(registry.check_claim(&holder, &symbol_short!("age"), &Some(18), &None));
    assert!(registry.check_claim(&holder, &symbol_short!("age"), &Some(16), &None));

    // A protocol requiring age >= 21 fails — the proof only covers >= 18.
    assert!(!registry.check_claim(&holder, &symbol_short!("age"), &Some(21), &None));
}

// ── check_claim property & boundary fuzz tests (Issue #26) ───────────────────

fn deploy_registry(env: &Env) -> (ProofRegistryClient<'static>, Address) {
    env.mock_all_auths();
    let admin = Address::generate(env);
    let v_id = Address::generate(env);
    let ir_id = Address::generate(env);
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    (ProofRegistryClient::new(env, &pr_id), pr_id)
}

fn set_proof_record(
    env: &Env,
    registry_id: &Address,
    holder: &Address,
    cred: &Symbol,
    record: &ProofRecord,
) {
    env.as_contract(registry_id, || {
        let key = DataKey::Proof(holder.clone(), cred.clone());
        env.storage().persistent().set(&key, record);
        env.storage()
            .persistent()
            .extend_ttl(&key, 17280, 17280 * 90);
    });
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    #[test]
    fn prop_check_claim_stored_ge_required_returns_true(
        required in any::<u64>(),
        offset in any::<u64>(),
    ) {
        // Generate stored >= required via saturating add to cover entire u64 space without overflow
        let stored = required.saturating_add(offset);

        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("funds");

        let record = ProofRecord {
            verified_at: 100,
            expiry: 1000,
            threshold: Some(stored),
            revoked: false,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let res = client.check_claim(&holder, &cred, &Some(required), &None);
        prop_assert!(res);
    }

    #[test]
    fn prop_check_claim_stored_lt_required_returns_false(
        required in 1..=u64::MAX,
        delta in 1..=u64::MAX,
    ) {
        // Generate stored < required
        let diff = (delta % required).max(1);
        let stored = required - diff;

        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("funds");

        let record = ProofRecord {
            verified_at: 100,
            expiry: 1000,
            threshold: Some(stored),
            revoked: false,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let res = client.check_claim(&holder, &cred, &Some(required), &None);
        prop_assert!(!res);
    }

    #[test]
    fn prop_check_claim_none_required_returns_true_for_valid_proof(
        stored in prop::option::of(any::<u64>()),
    ) {
        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("kyc");

        let record = ProofRecord {
            verified_at: 100,
            expiry: 1000,
            threshold: stored,
            revoked: false,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let res = client.check_claim(&holder, &cred, &None, &None);
        prop_assert!(res);
    }

    #[test]
    fn prop_check_claim_expired_or_revoked_always_returns_false(
        stored in prop::option::of(any::<u64>()),
        required in prop::option::of(any::<u64>()),
        revoked in any::<bool>(),
        expired in any::<bool>(),
    ) {
        if !revoked && !expired {
            return Ok(());
        }

        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("funds");

        let expiry = if expired { env.ledger().timestamp() } else { env.ledger().timestamp() + 1000 };

        let record = ProofRecord {
            verified_at: 100,
            expiry,
            threshold: stored,
            revoked,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let res = client.check_claim(&holder, &cred, &required, &None);
        prop_assert!(!res);
    }
}

#[test]
fn check_claim_boundary_values_exhaustive() {
    let env = Env::default();
    let (client, reg_id) = deploy_registry(&env);
    let cred = symbol_short!("funds");

    let boundaries = [0, 1, 2, u64::MAX / 2, u64::MAX - 1, u64::MAX];

    for &req in &boundaries {
        // Test exact match (stored == req) -> true
        {
            let holder = Address::generate(&env);
            let record = ProofRecord {
                verified_at: 100,
                expiry: 1000,
                threshold: Some(req),
                revoked: false,
                issuer: None,
                vk_version: 0,
            };
            set_proof_record(&env, &reg_id, &holder, &cred, &record);
            assert!(
                client.check_claim(&holder, &cred, &Some(req), &None),
                "Failed boundary stored == req for req={}",
                req
            );
        }

        // Test stored == req + 1 (if req < u64::MAX) -> true
        if req < u64::MAX {
            let stored = req + 1;
            let holder = Address::generate(&env);
            let record = ProofRecord {
                verified_at: 100,
                expiry: 1000,
                threshold: Some(stored),
                revoked: false,
                issuer: None,
                vk_version: 0,
            };
            set_proof_record(&env, &reg_id, &holder, &cred, &record);
            assert!(
                client.check_claim(&holder, &cred, &Some(req), &None),
                "Failed boundary stored == req + 1 for req={}",
                req
            );
        }

        // Test stored == req - 1 (if req > 0) -> false
        if req > 0 {
            let stored = req - 1;
            let holder = Address::generate(&env);
            let record = ProofRecord {
                verified_at: 100,
                expiry: 1000,
                threshold: Some(stored),
                revoked: false,
                issuer: None,
                vk_version: 0,
            };
            set_proof_record(&env, &reg_id, &holder, &cred, &record);
            assert!(
                !client.check_claim(&holder, &cred, &Some(req), &None),
                "Failed boundary stored == req - 1 for req={}",
                req
            );
        }
    }
}

#[test]
fn check_claim_stored_none_with_required_threshold() {
    let env = Env::default();
    let (client, reg_id) = deploy_registry(&env);
    let cred = symbol_short!("kyc");
    let holder1 = Address::generate(&env);
    let record1 = ProofRecord {
        verified_at: 100,
        expiry: 1000,
        threshold: None, // e.g. KYC proof without numeric threshold
        revoked: false,
        issuer: None,
        vk_version: 0,
    };
    set_proof_record(&env, &reg_id, &holder1, &cred, &record1);

    // None threshold defaults to 0 in unwrap_or(0).
    // So Some(0) returns true (0 >= 0), while Some(1) returns false (0 < 1).
    assert!(client.check_claim(&holder1, &cred, &Some(0), &None));
    assert!(!client.check_claim(&holder1, &cred, &Some(1), &None));
    assert!(!client.check_claim(&holder1, &cred, &Some(u64::MAX), &None));
}

// -- claim_expiry tests -----------------------------------------------------

fn kyc_submission(env: &Env, issuer: &Address, expiry: u64) -> ProofSubmission {
    ProofSubmission {
        credential_type: symbol_short!("kyc"),
        proof: Bytes::from_slice(env, PROOF),
        public_inputs: u8_slice_to_vec_u32(env, PUBLIC_INPUTS),
        issuer_id: issuer.clone(),
        expiry,
        vk_version: None,
    }
}

struct MultiHarness {
    registry: ProofRegistryClient<'static>,
    kyc_issuer: Address,
    funds_issuer: Address,
    age_issuer: Address,
}

fn deploy_multi(env: &Env) -> MultiHarness {
    let admin = Address::generate(env);
    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(env, &ir_id);

    let kyc_issuer = Address::generate(env);
    ir.register_issuer(
        &kyc_issuer,
        &pubkey_from(env, PUBLIC_INPUTS),
        &vec![env, symbol_short!("kyc")],
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64, 9999u64],
    );

    assert!(
        registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    let vc = CredentialVerifierClient::new(env, &v_id);
    vc.set_vk(&symbol_short!("kyc"), &1u32, &Bytes::from_slice(env, VK));
    vc.set_vk(
        &symbol_short!("funds"),
        &1u32,
        &Bytes::from_slice(env, FUNDS_VK),
    );
    vc.set_vk(
        &symbol_short!("age"),
        &1u32,
        &Bytes::from_slice(env, AGE_VK),
    );

    let pr_id = env.register(ProofRegistry, (admin.clone(), v_id, ir_id));
    MultiHarness {
        registry: ProofRegistryClient::new(env, &pr_id),
        kyc_issuer,
        funds_issuer,
        age_issuer,
    }
}

#[test]
fn batch_all_pass() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    let submissions = vec![
        &env,
        ProofSubmission {
            credential_type: symbol_short!("kyc"),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: h.kyc_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, FUNDS_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("age"),
            proof: Bytes::from_slice(&env, AGE_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, AGE_PUBLIC_INPUTS),
            issuer_id: h.age_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];

    h.registry.submit_proofs(&holder, &submissions);

    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );
}

#[test]
fn batch_one_fail_reverts_all() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    let mut bad_funds = FUNDS_PROOF.to_vec();
    bad_funds[5000] ^= 0xff;

    let submissions = vec![
        &env,
        ProofSubmission {
            credential_type: symbol_short!("kyc"),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: h.kyc_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, &bad_funds),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];

    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());

    // The valid kyc proof must NOT have been stored because the batch reverted.
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
    assert!(registry.check_claim(&holder, &symbol_short!("age"), &Some(18), &None));
    assert!(!registry.check_claim(&holder, &symbol_short!("age"), &Some(19), &None));
}

#[test]
fn aggregate_honors_per_credential_expiries() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &pubkey_from(&env, PUBLIC_INPUTS),
        &vec![
            &env,
            types[0].clone(),
            types[1].clone(),
            types[2].clone(),
            types[3].clone(),
            types[4].clone(),
        ],
        &demo_pubkey(&env),
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("aggregate"),
        &1u32,
        &Bytes::from_slice(&env, AGGREGATE_VK),
    );

    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    let submissions = vec![
        &env,
        ProofSubmission {
            credential_type: types[0].clone(),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: types[1].clone(),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: types[2].clone(),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: types[3].clone(),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: types[4].clone(),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];

    // Must not panic — 5 distinct types is within the allowed maximum.
    registry.submit_proofs(&holder, &submissions);
    assert!(registry.is_verified(&holder, &types[0], &None).0);
    assert!(registry.is_verified(&holder, &types[4], &None).0);
}

#[test]
fn batch_exceeds_max_size_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &pubkey_from(&env, PUBLIC_INPUTS),
        &vec![&env, symbol_short!("kyc")],
    );
    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("kyc"),
        &1u32,
        &Bytes::from_slice(&env, VK),
    );
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    let sub = kyc_submission(&env, &issuer, 9999);
    let submissions = vec![
        &env,
        sub.clone(),
        sub.clone(),
        sub.clone(),
        sub.clone(),
        sub.clone(),
        sub,
    ];

    let res = registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err());
    // KYC gets a long-lived expiry, age gets a shorter one — the two must be
    // stored independently, not collapsed onto one shared value.
    registry.submit_aggregate_proof(
        &holder,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 90_000u64, 5_000u64],
    );

    let kyc_record = registry.get_record(&holder, &symbol_short!("kyc")).unwrap();
    let age_record = registry.get_record(&holder, &symbol_short!("age")).unwrap();
    assert_eq!(kyc_record.expiry, 90_000);
    assert_eq!(age_record.expiry, 5_000);
    assert_ne!(kyc_record.expiry, age_record.expiry);
}

#[test]
fn aggregate_rejects_past_expiry_in_any_slot() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &demo_pubkey(&env),
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    let vc = CredentialVerifierClient::new(&env, &v_id);
    vc.set_vk(&symbol_short!("kyc"), &1u32, &Bytes::from_slice(&env, VK));
    vc.set_vk(
        &symbol_short!("funds"),
        &1u32,
        &Bytes::from_slice(&env, FUNDS_VK),
    );
    vc.set_vk(
        &symbol_short!("age"),
        &1u32,
        &Bytes::from_slice(&env, AGE_VK),
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("aggregate"),
        &1u32,
        &Bytes::from_slice(&env, AGGREGATE_VK),
    );

    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    // First slot valid, second slot (age) has a past expiry — whole call must revert.
    let res = registry.try_submit_aggregate_proof(
        &holder,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64, 0u64],
    );
    assert!(res.is_err());
    assert!(
        !registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );

    assert!(
        registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
    assert!(
        registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );

    registry.revoke_all(&holder);

    assert!(
        !registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        !registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
    assert!(
        !registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );
}

#[test]
fn aggregate_rejects_over_max_expiry_in_any_slot() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &demo_pubkey(&env),
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("aggregate"),
        &1u32,
        &Bytes::from_slice(&env, AGGREGATE_VK),
    );

    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    // First slot valid, second slot (age) has an over-max expiry — whole call must revert.
    let res = registry.try_submit_aggregate_proof(
        &holder,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64, u64::MAX],
    );

    // Both inner claims are verified after the single aggregate submission.
    assert!(
        registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );

    // The age threshold (18) is extracted from the aggregate layout and
    // enforced by check_claim.
    assert!(registry.check_claim(&holder, &symbol_short!("age"), &Some(18), &None));
    assert!(!registry.check_claim(&holder, &symbol_short!("age"), &Some(19), &None));
}

// ── Admin / upgrade tests ────────────────────────────────────────────────────

#[test]
fn claim_expiry_returns_zero_for_nonexistent_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);

    let real_wasm = get_test_wasm(&env);
    let new_wasm_hash = env.deployer().upload_contract_wasm(real_wasm);

    h.registry.upgrade(&new_wasm_hash);
}

#[test]
fn upgrade_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);

    let real_wasm = get_test_wasm(&env);
    let new_wasm_hash = env.deployer().upload_contract_wasm(real_wasm);

    let res = h.registry.mock_auths(&[]).try_upgrade(&new_wasm_hash);
    assert!(res.is_err());
}

#[test]
fn claim_expiry_returns_expiry_even_after_expired() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);

    let new_admin = Address::generate(&env);

    h.registry.set_admin(&new_admin);
    assert_eq!(h.registry.admin(), new_admin);

    let real_wasm = get_test_wasm(&env);
    let new_wasm_hash = env.deployer().upload_contract_wasm(real_wasm);

    let res = h
        .registry
        .mock_auths(&[MockAuth {
            address: &h.admin,
            invoke: &MockAuthInvoke {
                contract: &h.registry.address,
                fn_name: "upgrade",
                args: (&new_wasm_hash,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_upgrade(&new_wasm_hash);
    assert!(res.is_err());

    h.registry
        .mock_auths(&[MockAuth {
            address: &new_admin,
            invoke: &MockAuthInvoke {
                contract: &h.registry.address,
                fn_name: "upgrade",
                args: (&new_wasm_hash,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .upgrade(&new_wasm_hash);
}

#[test]
fn set_admin_by_non_admin_panics() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let new_admin = Address::generate(&env);
    let res = h.registry.mock_auths(&[]).try_set_admin(&new_admin);
    assert!(res.is_err());
    assert!(
        !registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
}
// ── Delegated verification (#396) ────────────────────────────────────────────

#[test]
fn grant_then_verifier_can_check() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    env.as_contract(&h.registry_id, || {
        let key = DataKey::Proof(holder.clone(), symbol_short!("kyc"));
        let legacy = LegacyProofRecord {
            verified_at: 500,
            expiry: 1000,
            threshold: None,
            revoked: false,
        };
        env.storage().persistent().set(&key, &legacy);
    });

    let result = h
        .registry
        .try_is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(result.is_err());
}

// ── get_record tests ──────────────────────────────────────────────────────────

#[test]
fn get_record_returns_full_proof_record_when_present() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000);

    let record = h
        .registry
        .get_record(&holder, &symbol_short!("kyc"))
        .expect("Record should exist");

    assert_eq!(record.verified_at, env.ledger().timestamp());
    assert_eq!(record.expiry, 1000);
    assert_eq!(record.threshold, None);
    assert!(!record.revoked);
    assert_eq!(record.issuer, Some(h.issuer.clone()));
}

// ── Property-based tests ──────────────────────────────────────────────────────

/// Property: No proof from an unregistered issuer is ever accepted.
/// For any holder and unregistered issuer, submitting a proof must fail
/// and `is_verified` must return false.
#[test]
fn prop_unregistered_issuer_always_rejected() {
    let config = proptest::test_runner::Config {
        cases: 10,
        ..proptest::test_runner::Config::default()
    };
    let mut runner = proptest::test_runner::TestRunner::new(config);
    runner
        .run(&(0u64..u64::MAX), |_seed| {
            let env = Env::default();
            env.mock_all_auths();
            let h = deploy(&env);
            let holder = Address::generate(&env);
            let unregistered = Address::generate(&env);

            let res = h.registry.try_submit_proof(
                &holder,
                &unregistered,
                &symbol_short!("kyc"),
                &Bytes::from_slice(&env, PROOF),
                &Bytes::from_slice(&env, PUBLIC_INPUTS),
                &None,
                &1000,
            );

            prop_assert!(res.is_err(), "Unregistered issuer should not be accepted");
            let (valid, _, _) = h
                .registry
                .is_verified(&holder, &symbol_short!("kyc"), &None);
            prop_assert!(
                !valid,
                "is_verified should return false for unregistered issuer"
            );
            Ok(())
        })
        .unwrap();
}

/// Property: check_claim(threshold) is monotonic.
/// If `check_claim(&holder, &type, &Some(T), &None)` returns true,
/// then `check_claim(&holder, &type, &Some(T'), &None)` must also return true
/// for all T' <= T.
#[test]
fn prop_check_claim_monotonic_in_threshold() {
    let config = proptest::test_runner::Config {
        cases: 10,
        ..proptest::test_runner::Config::default()
    };
    let mut runner = proptest::test_runner::TestRunner::new(config);
    runner
        .run(
            &(0u64..500_000u64, 0u64..500_000u64),
            |(threshold_a, threshold_b)| {
                let env = Env::default();
                env.mock_all_auths();
                let admin = Address::generate(&env);

                let ir_id = env.register(IssuerRegistry, (admin.clone(),));
                let ir = IssuerRegistryClient::new(&env, &ir_id);
                let issuer = Address::generate(&env);
                ir.register_issuer(
                    &issuer,
                    &pubkey_from(&env, FUNDS_PUBLIC_INPUTS),
                    &vec![&env, symbol_short!("funds")],
                );

                let v_id = env.register(CredentialVerifier, (admin.clone(),));
                CredentialVerifierClient::new(&env, &v_id).set_vk(
                    &symbol_short!("funds"),
                    &1u32,
                    &Bytes::from_slice(&env, FUNDS_VK),
                );

                let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
                let registry = ProofRegistryClient::new(&env, &pr_id);
                let holder = Address::generate(&env);

                registry.submit_proof(
                    &holder,
                    &issuer,
                    &symbol_short!("funds"),
                    &Bytes::from_slice(&env, FUNDS_PROOF),
                    &Bytes::from_slice(&env, FUNDS_PUBLIC_INPUTS),
                    &None,
                    &9999,
                );

                let t = std::cmp::min(threshold_a, threshold_b);
                let t_prime = std::cmp::max(threshold_a, threshold_b);

                let claim_at_t =
                    registry.check_claim(&holder, &symbol_short!("funds"), &Some(t), &None);
                let claim_at_t_prime =
                    registry.check_claim(&holder, &symbol_short!("funds"), &Some(t_prime), &None);

                // Monotonicity: if the proof passes at a lower threshold T,
                // it must also pass at a higher threshold T' where T' <= T.
                if t <= 200_000 && t_prime <= 200_000 {
                    prop_assert!(claim_at_t, "check_claim at T={} should be true", t);
                    prop_assert!(
                        claim_at_t_prime,
                        "check_claim at T'={} should be true since T' <= T",
                        t_prime
                    );
                }
                Ok(())
            },
        )
        .unwrap();
}

/// Property: Expired claims always read as false.
/// If a proof's expiry is in the past relative to the current ledger timestamp,
/// both `is_verified` and `check_claim` must return false.
#[test]
fn prop_expired_claims_always_false() {
    let config = proptest::test_runner::Config {
        cases: 10,
        ..proptest::test_runner::Config::default()
    };
    let mut runner = proptest::test_runner::TestRunner::new(config);
    runner
        .run(&(0u64..1000u64), |expiry| {
            let env = Env::default();
            env.mock_all_auths();
            let h = deploy(&env);
            let holder = Address::generate(&env);

            // Soroban's default ledger timestamp starts at 1,
            // so any expiry value < current timestamp is in the past.
            h.registry.submit_proof(
                &holder,
                &h.issuer,
                &symbol_short!("kyc"),
                &Bytes::from_slice(&env, PROOF),
                &Bytes::from_slice(&env, PUBLIC_INPUTS),
                &None,
                &expiry,
            );

            // Move ledger time to expiry + 1 so the proof is expired.
            env.ledger().with_mut(|li| li.timestamp = expiry + 1);

            let (valid, _, _) = h
                .registry
                .is_verified(&holder, &symbol_short!("kyc"), &None);
            prop_assert!(!valid, "is_verified should return false for expired proof");

            let claim = h
                .registry
                .check_claim(&holder, &symbol_short!("kyc"), &None, &None);
            prop_assert!(!claim, "check_claim should return false for expired proof");
            Ok(())
        })
        .unwrap();
}

/// Property: Revoked claims always read as false.
/// If a proof is revoked, both `is_verified` and `check_claim` must return false,
/// even if the proof is not yet expired.
#[test]
fn prop_revoked_claims_always_false() {
    let config = proptest::test_runner::Config {
        cases: 10,
        ..proptest::test_runner::Config::default()
    };
    let mut runner = proptest::test_runner::TestRunner::new(config);
    runner
        .run(&(0u64..u64::MAX), |_seed| {
            let env = Env::default();
            env.mock_all_auths();
            let h = deploy(&env);
            let holder = Address::generate(&env);

            // Submit a valid, non-expired proof with a far-future expiry.
            h.registry.submit_proof(
                &holder,
                &h.issuer,
                &symbol_short!("kyc"),
                &Bytes::from_slice(&env, PROOF),
                &Bytes::from_slice(&env, PUBLIC_INPUTS),
                &None,
                &5000,
            );

            // Verify it's valid before revocation.
            let (valid_before, _, _) =
                h.registry
                    .is_verified(&holder, &symbol_short!("kyc"), &None);
            prop_assert!(valid_before, "Proof should be valid before revocation");

            // Revoke the proof.
            h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));

            // After revocation, is_verified must return false.
            let (valid_after, _, _) = h
                .registry
                .is_verified(&holder, &symbol_short!("kyc"), &None);
            prop_assert!(
                !valid_after,
                "is_verified should return false after revocation"
            );

            // check_claim must also return false.
            let claim = h
                .registry
                .check_claim(&holder, &symbol_short!("kyc"), &None, &None);
            prop_assert!(!claim, "check_claim should return false after revocation");
            Ok(())
        })
        .unwrap();
    h.registry
        .grant_verification(&holder, &verifier, &symbol_short!("kyc"), &5000);

    let (valid, verified_at, expiry) = h.registry.check_delegated_verification(
        &holder,
        &verifier,
        &symbol_short!("kyc"),
    );
    assert!(valid);
    assert_eq!(expiry, 9999); // the underlying claim's own expiry, not the grant's
    let (_, expected_at, _) = h
        .registry
        .is_verified(&holder, &symbol_short!("kyc"), &None);
    assert_eq!(verified_at, expected_at);
}

#[test]
fn check_delegated_verification_without_a_grant_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    // The claim itself is valid, but this verifier was never delegated to.
    let (valid, verified_at, expiry) = h.registry.check_delegated_verification(
        &holder,
        &verifier,
        &symbol_short!("kyc"),
    );
    assert!(!valid);
    assert_eq!(verified_at, 0);
    assert_eq!(expiry, 0);
}

#[test]
fn grant_is_scoped_to_the_named_verifier_only() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let granted_verifier = Address::generate(&env);
    let other_verifier = Address::generate(&env);
    submit(&env, &h, &holder, 9999);
    h.registry
        .grant_verification(&holder, &granted_verifier, &symbol_short!("kyc"), &5000);

    assert!(h
        .registry
        .get_record(&holder, &symbol_short!("kyc"))
        .is_none());
    assert!(h
        .registry
        .get_record(&holder, &symbol_short!("funds"))
        .is_none());
    assert!(
        h.registry
            .check_delegated_verification(&holder, &granted_verifier, &symbol_short!("kyc"))
            .0
    );
    assert!(
        !h.registry
            .check_delegated_verification(&holder, &other_verifier, &symbol_short!("kyc"))
            .0
    );
}

#[test]
fn grant_expires_correctly() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    submit(&env, &h, &holder, 20_000_000); // claim itself long-lived (within the 1-year cap)
    h.registry
        .grant_verification(&holder, &verifier, &symbol_short!("kyc"), &5000);

    env.as_contract(&h.registry_id, || {
        let key = DataKey::Proof(holder.clone(), symbol_short!("kyc"));
        let legacy = LegacyProofRecord {
            verified_at: 500,
            expiry: 1000,
            threshold: None,
            revoked: false,
        };
        env.storage().persistent().set(&key, &legacy);
    });

    h.registry.migrate_record(&holder, &symbol_short!("kyc"));

    // Without a trusted_issuers filter the record is valid.
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &None));
    assert!(
        h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );

    env.ledger().with_mut(|li| li.timestamp = 5000);
    assert!(
        !h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );
}

#[test]
fn revoke_verification_removes_the_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(&env, &ir_id);
    let issuer = Address::generate(&env);
    ir.register_issuer(
        &issuer,
        &pubkey_from(&env, FUNDS_PUBLIC_INPUTS),
        &vec![&env, symbol_short!("funds")],
    );
    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(&env, &v_id).set_vk(
        &symbol_short!("funds"),
        &1u32,
        &Bytes::from_slice(&env, FUNDS_VK),
    );
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    submit(&env, &h, &holder, 9999);
    h.registry
        .grant_verification(&holder, &verifier, &symbol_short!("kyc"), &5000);
    assert!(
        h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );

    h.registry
        .revoke_verification(&holder, &verifier, &symbol_short!("kyc"));

    assert!(
        !h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );
}

#[test]
fn revoke_verification_on_a_never_granted_delegation_is_a_no_op() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);

    // Must not panic — matches the doc comment's "no-op, not an error".
    h.registry
        .revoke_verification(&holder, &verifier, &symbol_short!("kyc"));
}

#[test]
fn delegated_check_reflects_a_revoked_underlying_claim_even_with_a_live_grant() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    submit(&env, &h, &holder, 9999);
    h.registry
        .grant_verification(&holder, &verifier, &symbol_short!("kyc"), &5000);
    assert!(
        h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );

    // The grant itself is still live, but the underlying claim is gone —
    // check_delegated_verification must reflect that, not just the grant.
    h.registry.revoke_proof(&holder, &symbol_short!("kyc"));

    // Verify the legacy record is still unreadable (migration did NOT happen).
    let after = h
        .registry
        .try_is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(after.is_err());
    assert!(
        !h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );
}

#[test]
fn grant_rejects_an_expiry_in_the_past() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    env.ledger().with_mut(|li| li.timestamp = 1000);

    // Submit a proof normally — this writes a 5-field current-format record.
    submit(&env, &h, &holder, 1000);
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );

    // Migrate on an already-current record — must succeed (no-op).
    h.registry.migrate_record(&holder, &symbol_short!("kyc"));

    // Record is still valid and unchanged.
    let (valid, _at, expiry) = h
        .registry
        .is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(valid);
    assert_eq!(expiry, 1000);
    let res = h.registry.try_grant_verification(
        &holder,
        &verifier,
        &symbol_short!("kyc"),
        &500,
    );
    assert!(res.is_err());
}

#[test]
fn granting_the_same_verifier_again_overwrites_the_previous_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let verifier = Address::generate(&env);
    submit(&env, &h, &holder, 9999);
    h.registry
        .grant_verification(&holder, &verifier, &symbol_short!("kyc"), &2000);
    h.registry
        .grant_verification(&holder, &verifier, &symbol_short!("kyc"), &6000);

    env.ledger().with_mut(|li| li.timestamp = 3000);
    // Would be expired under the first grant (2000); still valid under the
    // second (6000), proving the overwrite actually took effect.
    assert!(
        h.registry
            .check_delegated_verification(&holder, &verifier, &symbol_short!("kyc"))
            .0
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Fuzz tests (proptest) — check_claim threshold boundaries & trusted_issuers
// Issue #417: fuzz/invariant coverage for security-critical read/write paths
// ═══════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(ProptestConfig::with_cases(100))]

    /// Fuzz: trusted_issuers combinations.
    /// For any (valid, issuer_in_list, filter_active), check_claim must
    /// correctly accept or reject based on the trusted_issuers filter.
    #[test]
    fn prop_check_claim_trusted_issuer_fuzz(
        valid in any::<bool>(),
        issuer_in_list in any::<bool>(),
        filter_active in any::<bool>(),
    ) {
        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let proof_issuer = Address::generate(&env);
        let other_addr = Address::generate(&env);
        let cred = symbol_short!("funds");

        let record = ProofRecord {
            verified_at: 100,
            expiry: if valid { 1000 } else { env.ledger().timestamp() },
            threshold: Some(200_000),
            revoked: !valid,
            issuer: Some(proof_issuer.clone()),
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let min_threshold = None::<u64>;
        let trusted = if filter_active {
            if issuer_in_list {
                Some(vec![&env, proof_issuer, other_addr])
            } else {
                Some(vec![&env, other_addr])
            }
        } else {
            None
        };

        let result = client.check_claim(&holder, &cred, &min_threshold, &trusted);

        if filter_active {
            // With an active filter, the proof is accepted only if the
            // issuer is in the list AND the proof is otherwise valid.
            prop_assert_eq!(result, valid && issuer_in_list);
        } else {
            // With no filter (None), issuer membership is irrelevant —
            // only proof validity matters.
            prop_assert_eq!(result, valid);
        }
    }

    /// Fuzz: threshold boundary comparison is correct for arbitrary values.
    /// The >= comparison must hold for every combination of stored and required
    /// threshold, including edge cases around 0, u64::MAX, and None.
    #[test]
    fn prop_check_claim_threshold_boundary_fuzz(
        stored_threshold in prop::option::of(any::<u64>()),
        min_threshold in any::<u64>(),
    ) {
        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("kyc");

        let record = ProofRecord {
            verified_at: 100,
            expiry: 1000,
            threshold: stored_threshold,
            revoked: false,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let result = client.check_claim(
            &holder,
            &cred,
            &Some(min_threshold),
            &None,
        );

        // The contract uses unwrap_or(0) for None thresholds.
        let effective_stored = stored_threshold.unwrap_or(0);
        prop_assert_eq!(result, effective_stored >= min_threshold);
    }

    /// Fuzz: threshold=0 always passes regardless of min_threshold.
    /// If the stored threshold is exactly 0, check_claim(&Some(0)) must
    /// return true and check_claim(&Some(1)) must return false.
    #[test]
    fn prop_check_claim_zero_threshold_fuzz(
        min_threshold in 0u64..=10_000,
    ) {
        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("kyc");

        let record = ProofRecord {
            verified_at: 100,
            expiry: 1000,
            threshold: Some(0),
            revoked: false,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let result = client.check_claim(&holder, &cred, &Some(min_threshold), &None);

        if min_threshold == 0 {
            prop_assert!(result, "0 >= 0 must be true");
        } else {
            prop_assert!(!result, "0 >= {} must be false", min_threshold);
        }
    }

    /// Invariant: a revoked or expired proof is never valid under any
    /// combination of threshold or trusted_issuers filter.
    #[test]
    fn prop_revoked_expired_never_valid_fuzz(
        revoked in any::<bool>(),
        expired in any::<bool>(),
        stored_threshold in prop::option::of(0u64..=500_000u64),
        min_threshold in prop::option::of(0u64..=500_000u64),
        use_filter in any::<bool>(),
    ) {
        if !revoked && !expired {
            return Ok(());
        }

        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let proof_issuer = Address::generate(&env);
        let cred = symbol_short!("funds");

        let expiry = if expired {
            env.ledger().timestamp()
        } else {
            env.ledger().timestamp() + 10_000
        };

        let record = ProofRecord {
            verified_at: 100,
            expiry,
            threshold: stored_threshold,
            revoked,
            issuer: Some(proof_issuer.clone()),
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let trusted = if use_filter {
            Some(vec![&env, proof_issuer])
        } else {
            None
        };

        let result = client.check_claim(&holder, &cred, &min_threshold, &trusted);
        prop_assert!(!result, "revoked={}, expired={}, filter={}: proof must not be valid", revoked, expired, use_filter);

        // Also verify via is_verified — consistency between the two read paths.
        let (valid, _, _) = client.is_verified(&holder, &cred, &trusted);
        prop_assert!(!valid, "is_verified must also return false for revoked/expired proofs");
    }

    /// Fuzz: issuer not in trusted list -> always rejected.
    /// For any set of addresses that does NOT contain the proof's issuer,
    /// check_claim must return false even if the proof is otherwise valid.
    #[test]
    fn prop_check_claim_untrusted_issuer_fuzz(
        extra_count in 0..=3,
    ) {
        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let proof_issuer = Address::generate(&env);
        let cred = symbol_short!("funds");

        let record = ProofRecord {
            verified_at: 100,
            expiry: 1000,
            threshold: Some(200_000),
            revoked: false,
            issuer: Some(proof_issuer),
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        // Build a trusted list that explicitly excludes the proof's issuer.
        let mut trust_list: Vec<Address> = Vec::new(&env);
        for _ in 0..extra_count {
            trust_list.push_back(Address::generate(&env));
        }

        // proof_issuer is NOT in trust_list, so check_claim must reject.
        let result = client.check_claim(
            &holder,
            &cred,
            &None,
            &Some(trust_list),
        );
        prop_assert!(!result, "proof from untrusted issuer must be rejected");
    }

    /// Fuzz: check_claim threshold=None is consistent with threshold=0.
    /// For non-parameterised credential types (like kyc), threshold is None
    /// internally; check_claim with min_threshold=0 must return the same
    /// result as min_threshold=None for a valid, unexpired proof.
    #[test]
    fn prop_check_claim_none_vs_zero_threshold_fuzz(
        valid in any::<bool>(),
        expired in any::<bool>(),
    ) {
        let env = Env::default();
        let (client, reg_id) = deploy_registry(&env);
        let holder = Address::generate(&env);
        let cred = symbol_short!("kyc");

        let expiry = if expired {
            env.ledger().timestamp()
        } else {
            1000
        };

        let record = ProofRecord {
            verified_at: 100,
            expiry,
            threshold: None, // kyc has no numeric threshold
            revoked: !valid,
            issuer: None,
            vk_version: 0,
        };
        set_proof_record(&env, &reg_id, &holder, &cred, &record);

        let with_none = client.check_claim(&holder, &cred, &None, &None);
        let with_zero = client.check_claim(&holder, &cred, &Some(0), &None);

        // None and Some(0) must agree for any validity state.
        prop_assert_eq!(with_none, with_zero);
        // Both must reflect overall proof validity.
        let expected = valid && !expired;
        prop_assert_eq!(with_none, expected);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Invariant tests — batch atomicity & proof validity invariants
// Issue #417: higher confidence in security-critical read/write paths
// ═══════════════════════════════════════════════════════════════════════════════

proptest! {
    #![proptest_config(ProptestConfig::with_cases(50))]

    /// Invariant: a batch either fully applies or fully reverts.
    /// If the second proof in a 2-proof batch is invalid (bad proof bytes),
    /// then NEITHER proof should be stored after the batch reverts.
    #[test]
    fn prop_batch_atomicity_all_or_nothing(
        corrupt_offset in 0..32usize,
        xor_byte in 1u8..=255u8,
    ) {
        let env = Env::default();
        env.mock_all_auths();
        env.cost_estimate().budget().reset_unlimited();
        let h = deploy_multi(&env);
        let holder = Address::generate(&env);

        let mut bad_proof = PROOF.to_vec();
        bad_proof[corrupt_offset] ^= xor_byte;

        let submissions = vec![
            &env,
            ProofSubmission {
                credential_type: symbol_short!("kyc"),
                proof: Bytes::from_slice(&env, PROOF),
                public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
                issuer_id: h.kyc_issuer.clone(),
                expiry: 9999,
                vk_version: None,
            },
            ProofSubmission {
                credential_type: symbol_short!("funds"),
                proof: Bytes::from_slice(&env, &bad_proof),
                public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
                issuer_id: h.funds_issuer.clone(),
                expiry: 9999,
                vk_version: None,
            },
        ];

        let res = h.registry.try_submit_proofs(&holder, &submissions);
        prop_assert!(res.is_err(), "batch with bad proof must fail");

        // CRITICAL INVARIANT: the valid KYC proof must NOT have been stored.
        let (kyc_valid, _, _) = h.registry.is_verified(&holder, &symbol_short!("kyc"), &None);
        prop_assert!(!kyc_valid, "batch reverted — kyc proof must not be stored");

        let (funds_valid, _, _) = h.registry.is_verified(&holder, &symbol_short!("funds"), &None);
        prop_assert!(!funds_valid, "batch reverted — funds proof must not be stored");
    }

    /// Invariant: a revoked proof never reads valid.
    /// After revocation, both is_verified and check_claim must return
    /// false regardless of trusted_issuers or threshold parameters.
    #[test]
    fn prop_invariant_revoked_never_valid(
        use_issuer_filter in any::<bool>(),
        use_threshold in any::<bool>(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let h = deploy(&env);
        let holder = Address::generate(&env);

        submit(&env, &h, &holder, 5000);

        // Verify valid before revocation.
        let (before, _, _) = h.registry.is_verified(&holder, &symbol_short!("kyc"), &None);
        prop_assert!(before, "proof should be valid before revocation");

        h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));

        let trusted = if use_issuer_filter {
            Some(vec![&env, h.issuer.clone()])
        } else {
            None
        };
        let threshold = if use_threshold { Some(0) } else { None };

        let (valid, _, _) = h.registry.is_verified(&holder, &symbol_short!("kyc"), &trusted);
        prop_assert!(!valid, "is_verified: revoked proof must not be valid (filter={})", use_issuer_filter);

        let claim = h.registry.check_claim(&holder, &symbol_short!("kyc"), &threshold, &trusted);
        prop_assert!(!claim, "check_claim: revoked proof must not be valid (threshold={:?}, filter={})", threshold, use_issuer_filter);

        // get_record must still return the record for audit.
        let record = h.registry.get_record(&holder, &symbol_short!("kyc"));
        prop_assert!(record.is_some(), "revoked record must still be readable for audit");
        prop_assert!(record.unwrap().revoked, "record must be marked revoked");
    }

    /// Invariant: an expired proof never reads valid.
    /// After advancing the ledger past expiry, is_verified and check_claim
    /// must return false regardless of other parameters.
    #[test]
    fn prop_invariant_expired_never_valid(
        use_issuer_filter in any::<bool>(),
        use_threshold in any::<bool>(),
    ) {
        let env = Env::default();
        env.mock_all_auths();
        let h = deploy(&env);
        let holder = Address::generate(&env);

        submit(&env, &h, &holder, 100);

        // Advance time past expiry.
        env.ledger().with_mut(|li| li.timestamp = 101);

        let trusted = if use_issuer_filter {
            Some(vec![&env, h.issuer.clone()])
        } else {
            None
        };
        let threshold = if use_threshold { Some(0) } else { None };

        let (valid, _, _) = h.registry.is_verified(&holder, &symbol_short!("kyc"), &trusted);
        prop_assert!(!valid, "is_verified: expired proof must not be valid");

        let claim = h.registry.check_claim(&holder, &symbol_short!("kyc"), &threshold, &trusted);
        prop_assert!(!claim, "check_claim: expired proof must not be valid");

        // get_record must still return the record (expiry data preserved for audit).
        let record = h.registry.get_record(&holder, &symbol_short!("kyc"));
        prop_assert!(record.is_some(), "expired record must still be readable for audit");
        prop_assert_eq!(record.unwrap().expiry, 100);
    }
}

/// Invariant: batch with duplicate credential_type is always rejected.
/// Regardless of which type is duplicated, the batch must fail.
#[test]
fn batch_duplicate_type_invariant_rejects_all_combinations() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    // Test duplicate kyc in any position.
    let kyc_sub = ProofSubmission {
        credential_type: symbol_short!("kyc"),
        proof: Bytes::from_slice(&env, PROOF),
        public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
        issuer_id: h.kyc_issuer.clone(),
        expiry: 9999,
        vk_version: None,
    };
    let funds_sub = ProofSubmission {
        credential_type: symbol_short!("funds"),
        proof: Bytes::from_slice(&env, FUNDS_PROOF),
        public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
        issuer_id: h.funds_issuer.clone(),
        expiry: 9999,
        vk_version: None,
    };

    // kyc, kyc, funds — duplicate kyc
    let batch1 = vec![&env, kyc_sub.clone(), kyc_sub.clone(), funds_sub.clone()];
    let res = h.registry.try_submit_proofs(&holder, &batch1);
    assert!(res.is_err(), "batch with duplicate kyc must fail");

    // funds, kyc, funds — duplicate funds
    let batch2 = vec![&env, funds_sub.clone(), kyc_sub.clone(), funds_sub];
    let res = h.registry.try_submit_proofs(&holder, &batch2);
    assert!(res.is_err(), "batch with duplicate funds must fail");

    // Verify nothing was stored from either failed batch.
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
}

/// Invariant: single-proof revocation does not affect other credential types.
/// Revoking one credential type must leave all other types intact.
#[test]
fn single_revocation_does_not_affect_other_types() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    let submissions = vec![
        &env,
        ProofSubmission {
            credential_type: symbol_short!("kyc"),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: h.kyc_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, FUNDS_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("age"),
            proof: Bytes::from_slice(&env, AGE_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, AGE_PUBLIC_INPUTS),
            issuer_id: h.age_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];
    h.registry.submit_proofs(&holder, &submissions);

    // Revoke only kyc.
    h.registry
        .revoke(&h.kyc_issuer, &holder, &symbol_short!("kyc"));

    // kyc must be revoked.
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(!h
        .registry
        .check_claim(&holder, &symbol_short!("kyc"), &None, &None));

    // funds and age must remain valid.
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
    assert!(h
        .registry
        .check_claim(&holder, &symbol_short!("funds"), &None, &None));
    assert!(
        h.registry
            .is_verified(&holder, &symbol_short!("age"), &None)
            .0
    );
    assert!(h
        .registry
        .check_claim(&holder, &symbol_short!("age"), &None, &None));
}

/// Invariant: batch expiry validation — all submissions must have valid expiry.
/// If any submission has an invalid expiry, the entire batch must revert
/// and no proofs must be stored.
#[test]
fn batch_expiry_rejects_all_if_any_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    // Set ledger time to 5000.
    env.ledger().with_mut(|li| li.timestamp = 5000);

    let submissions = vec![
        &env,
        // Valid submission with expiry in the future.
        ProofSubmission {
            credential_type: symbol_short!("kyc"),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: h.kyc_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        // Invalid submission: expiry in the past.
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, FUNDS_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 4999, // before current timestamp 5000
            vk_version: None,
        },
    ];

    let res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(res.is_err(), "batch with past expiry must fail");

    // Neither proof must be stored.
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("kyc"), &None)
            .0
    );
    assert!(
        !h.registry
            .is_verified(&holder, &symbol_short!("funds"), &None)
            .0
    );
}

/// Invariant: after a successful batch submission, all submitted credential
/// types are independently queryable and have the correct issuer stored.
#[test]
fn successful_batch_preserves_issuer_and_threshold() {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    let h = deploy_multi(&env);
    let holder = Address::generate(&env);

    let submissions = vec![
        &env,
        ProofSubmission {
            credential_type: symbol_short!("kyc"),
            proof: Bytes::from_slice(&env, PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, PUBLIC_INPUTS),
            issuer_id: h.kyc_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("funds"),
            proof: Bytes::from_slice(&env, FUNDS_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, FUNDS_PUBLIC_INPUTS),
            issuer_id: h.funds_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
        ProofSubmission {
            credential_type: symbol_short!("age"),
            proof: Bytes::from_slice(&env, AGE_PROOF),
            public_inputs: u8_slice_to_vec_u32(&env, AGE_PUBLIC_INPUTS),
            issuer_id: h.age_issuer.clone(),
            expiry: 9999,
            vk_version: None,
        },
    ];
    h.registry.submit_proofs(&holder, &submissions);

    // Verify each credential type has the correct issuer and threshold.
    let kyc_record = h
        .registry
        .get_record(&holder, &symbol_short!("kyc"))
        .unwrap();
    assert_eq!(kyc_record.issuer, Some(h.kyc_issuer.clone()));
    assert_eq!(kyc_record.threshold, None); // kyc has no threshold
    assert!(!kyc_record.revoked);
    assert_eq!(kyc_record.expiry, 9999);

    let funds_record = h
        .registry
        .get_record(&holder, &symbol_short!("funds"))
        .unwrap();
    assert_eq!(funds_record.issuer, Some(h.funds_issuer.clone()));
    assert_eq!(funds_record.threshold, Some(200_000)); // funds threshold from public inputs
    assert!(!funds_record.revoked);
    assert_eq!(funds_record.expiry, 9999);

    let age_record = h
        .registry
        .get_record(&holder, &symbol_short!("age"))
        .unwrap();
    assert_eq!(age_record.issuer, Some(h.age_issuer.clone()));
    assert_eq!(age_record.threshold, Some(18)); // age threshold from public inputs
    assert!(!age_record.revoked);
    assert_eq!(age_record.expiry, 9999);

    // Trusted issuer filters must work correctly.
    assert!(h.registry.check_claim(
        &holder,
        &symbol_short!("kyc"),
        &None,
        &Some(vec![&env, h.kyc_issuer.clone()]),
    ));
    assert!(!h.registry.check_claim(
        &holder,
        &symbol_short!("kyc"),
        &None,
        &Some(vec![&env, h.funds_issuer.clone()]), // wrong issuer
    ));
}
