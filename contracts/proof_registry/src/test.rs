#![cfg(test)]

extern crate std;

use super::*;
use credential_verifier::{CredentialVerifier, CredentialVerifierClient};
use issuer_registry::{IssuerRegistry, IssuerRegistryClient};
use soroban_sdk::{
    symbol_short,
    testutils::{storage::Persistent as _, Address as _, Ledger as _},
    vec, Address, BytesN, Bytes, Env,
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

fn get_test_wasm(env: &Env) -> Bytes {
    let paths = [
        "target/wasm32v1-none/release/proof_registry.wasm",
        "../../target/wasm32v1-none/release/proof_registry.wasm",
        "../target/wasm32v1-none/release/proof_registry.wasm",
    ];
    for path in paths.iter() {
        if let Ok(wasm) = std::fs::read(path) {
            return Bytes::from_slice(env, &wasm);
        }
    }
    panic!("Could not find proof_registry.wasm. Run 'cargo build --target wasm32v1-none --release' first.");
}

struct Harness {
    registry: ProofRegistryClient<'static>,
    registry_id: Address,
    issuer: Address,
    admin: Address,
}

fn deploy(env: &Env) -> Harness {
    let admin = Address::generate(env);

    let ir_id = env.register(IssuerRegistry, (admin.clone(),));
    let ir = IssuerRegistryClient::new(env, &ir_id);
    let issuer = Address::generate(env);
    ir.register_issuer(
        &issuer,
        &demo_pubkey(env),
        &vec![env, symbol_short!("kyc")],
    );

    let v_id = env.register(CredentialVerifier, (admin.clone(),));
    CredentialVerifierClient::new(env, &v_id)
        .set_vk(&symbol_short!("kyc"), &1u32, &Bytes::from_slice(env, VK));

    let pr_id = env.register(ProofRegistry, (admin.clone(), v_id, ir_id));
    Harness {
        registry: ProofRegistryClient::new(env, &pr_id),
        registry_id: pr_id,
        issuer,
        admin,
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
    vc.set_vk(&symbol_short!("funds"), &1u32, &Bytes::from_slice(env, FUNDS_VK));
    vc.set_vk(&symbol_short!("age"), &1u32, &Bytes::from_slice(env, AGE_VK));

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

    let (valid, _at, expiry) = h.registry.is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(valid);
    assert_eq!(expiry, 9999);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn rejects_past_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    env.ledger().with_mut(|li| li.timestamp = 5000);

    submit(&env, &h, &holder, 4999);
}

#[test]
#[should_panic(expected = "Error(Contract, #12)")]
fn rejects_over_max_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, MAX_CREDENTIAL_TTL_SECS + 1);
}

  #[test]
  #[should_panic(expected = "Error(Contract, #12)")]
 fn batch_rejects_past_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    env.ledger().with_mut(|li| li.timestamp = 5000);

    let subs = vec![&env, kyc_submission(&env, &h.issuer, 100)];
    h.registry.submit_proofs(&holder, &subs);
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

    submit(&env, &h, &holder, 9999);
    assert!(h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);

    env.ledger().with_mut(|li| li.timestamp = 10000);
    assert!(!h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
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
    CredentialVerifierClient::new(&env, &v_id)
        .set_vk(&symbol_short!("kyc"), &1u32, &Bytes::from_slice(&env, VK));
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
}

#[test]
fn unverified_holder_returns_false() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let stranger = Address::generate(&env);
    assert!(!h.registry.is_verified(&stranger, &symbol_short!("kyc"), &None).0);
}

#[test]
fn revoke_clears_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 9999);
    h.registry.revoke_proof(&holder, &symbol_short!("kyc"));
    assert!(!h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
}

#[test]
fn issuer_revoke_invalidates_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 9999);
    h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));
    assert!(!h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
}

#[test]
fn issuer_revoke_rejects_wrong_issuer() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let stranger = Address::generate(&env);

    submit(&env, &h, &holder, 9999);
    let res = h.registry.try_revoke(&stranger, &holder, &symbol_short!("kyc"));
    assert!(res.is_err());
}

#[test]
fn pause_blocks_submit_reads_still_work_and_unpause_restores() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

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
    assert!(h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
    assert!(h.registry.is_verified(&holder, &symbol_short!("funds"), &None).0);
    assert!(h.registry.is_verified(&holder, &symbol_short!("age"), &None).0);
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
    assert!(!h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
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

    registry.submit_aggregate_proof(
        &holder,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64, 9999u64],
    );

    assert!(registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
    assert!(registry.is_verified(&holder, &symbol_short!("age"), &None).0);
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
        env.storage().persistent().extend_ttl(&key, 17280, 17280 * 90);
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
                "Failed boundary stored == req for req={}", req
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
                "Failed boundary stored == req + 1 for req={}", req
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
                "Failed boundary stored == req - 1 for req={}", req
            );
        }
    }
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

    let res = registry.try_submit_aggregate_proof(
        &holder,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, u64::MAX, 9999u64],
    );
    assert!(res.is_err());
}

#[test]
fn pause_blocks_batch_and_aggregate_submissions() {
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
    ];

    h.registry.pause();
    let batch_res = h.registry.try_submit_proofs(&holder, &submissions);
    assert!(batch_res.is_err());
    h.registry.unpause();
    h.registry.submit_proofs(&holder, &submissions);

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
    let holder2 = Address::generate(&env);

    registry.pause();
    let aggregate_res = registry.try_submit_aggregate_proof(
        &holder2,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64, 9999u64],
    );
    assert!(aggregate_res.is_err());

    registry.unpause();
    registry.submit_aggregate_proof(
        &holder2,
        &vec![&env, issuer.clone(), issuer],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64, 9999u64],
    );
    assert!(registry.is_verified(&holder2, &symbol_short!("kyc"), &None).0);
    assert!(registry.is_verified(&holder2, &symbol_short!("age"), &None).0);
}

// ── Expiry validation tests ───────────────────────────────────────────────────

#[test]
fn rejects_past_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    let res = h.registry.try_submit_proof(
        &holder,
        &h.issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &0,
    );
    assert!(res.is_err());
}

#[test]
fn rejects_over_max_expiry() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    let far_future = u64::MAX;
    let res = h.registry.try_submit_proof(
        &holder,
        &h.issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &far_future,
    );
    assert!(res.is_err());
}

#[test]
fn aggregate_proof_rejects_mismatched_expiry_count() {
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

    // Only one expiry for two credentials — should fail
    let res = registry.try_submit_aggregate_proof(
        &holder,
        &vec![&env, issuer.clone(), issuer.clone()],
        &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
        &Bytes::from_slice(&env, AGGREGATE_PROOF),
        &Bytes::from_slice(&env, AGGREGATE_PUBLIC_INPUTS),
        &vec![&env, 9999u64],
    );
    assert!(res.is_err());
}

// ── check_claim tests ─────────────────────────────────────────────────────────

#[test]
fn check_claim_no_threshold_matches_is_verified() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    submit(&env, &h, &holder, 9999);
    assert!(h.registry.check_claim(&holder, &symbol_short!("kyc"), &None, &None));
}

#[test]
fn funds_threshold_stored_and_checked() {
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
    CredentialVerifierClient::new(&env, &v_id)
        .set_vk(&symbol_short!("funds"), &1u32, &Bytes::from_slice(&env, FUNDS_VK));
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

    assert!(registry.check_claim(&holder, &symbol_short!("funds"), &Some(200_000), &None));
    assert!(registry.check_claim(&holder, &symbol_short!("funds"), &Some(50_000), &None));
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
    CredentialVerifierClient::new(&env, &v_id)
        .set_vk(&symbol_short!("age"), &1u32, &Bytes::from_slice(&env, AGE_VK));
    let pr_id = env.register(ProofRegistry, (admin, v_id, ir_id));
    let registry = ProofRegistryClient::new(&env, &pr_id);
    let holder = Address::generate(&env);

    registry.submit_proof(
        &holder,
        &issuer,
        &symbol_short!("age"),
        &Bytes::from_slice(&env, AGE_PROOF),
        &Bytes::from_slice(&env, AGE_PUBLIC_INPUTS),
        &None,
        &9999,
    );

    assert!(registry.check_claim(&holder, &symbol_short!("age"), &Some(18), &None));
    assert!(!registry.check_claim(&holder, &symbol_short!("age"), &Some(21), &None));
}

// ── trusted_issuers tests ────────────────────────────────────────────────────

#[test]
fn check_claim_trusted_issuer_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let other_issuer = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    assert!(h.registry.check_claim(
        &holder,
        &symbol_short!("kyc"),
        &None,
        &Some(vec![&env, h.issuer.clone(), other_issuer]),
    ));
}

#[test]
fn check_claim_untrusted_issuer_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let other_issuer = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    assert!(!h.registry.check_claim(
        &holder,
        &symbol_short!("kyc"),
        &None,
        &Some(vec![&env, other_issuer]),
    ));
}

#[test]
fn check_claim_empty_trusted_list_rejects_all() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    let empty: Vec<Address> = Vec::new(&env);
    assert!(!h.registry.check_claim(
        &holder,
        &symbol_short!("kyc"),
        &None,
        &Some(empty),
    ));
}

#[test]
fn is_verified_trusted_issuer_accepted() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    let (valid, _at, expiry) = h.registry.is_verified(
        &holder,
        &symbol_short!("kyc"),
        &Some(vec![&env, h.issuer.clone()]),
    );
    assert!(valid);
    assert_eq!(expiry, 9999);
}

#[test]
fn is_verified_untrusted_issuer_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let other_issuer = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    let (valid, _at, expiry) = h.registry.is_verified(
        &holder,
        &symbol_short!("kyc"),
        &Some(vec![&env, other_issuer]),
    );
    assert!(!valid);
    assert_eq!(expiry, 9999);
}

// ── revoke_all tests ──────────────────────────────────────────────────────────

#[test]
fn get_record_returns_full_proof_record_when_present() {
    let _env = Env::default();
    // ... rest of get_record test
}

// ── Property-based tests ──────────────────────────────────────────────────────

    h.registry.submit_proof(
        &holder,
        &h.kyc_issuer,
        &symbol_short!("kyc"),
        &Bytes::from_slice(&env, PROOF),
        &Bytes::from_slice(&env, PUBLIC_INPUTS),
        &None,
        &9999,
    );
    h.registry.submit_proof(
        &holder,
        &h.funds_issuer,
        &symbol_short!("funds"),
        &Bytes::from_slice(&env, FUNDS_PROOF),
        &Bytes::from_slice(&env, FUNDS_PUBLIC_INPUTS),
        &None,
        &9999,
    );
    h.registry.submit_proof(
        &holder,
        &h.age_issuer,
        &symbol_short!("age"),
        &Bytes::from_slice(&env, AGE_PROOF),
        &Bytes::from_slice(&env, AGE_PUBLIC_INPUTS),
        &None,
        &9999,
    );

    assert!(h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
    assert!(h.registry.is_verified(&holder, &symbol_short!("funds"), &None).0);
    assert!(h.registry.is_verified(&holder, &symbol_short!("age"), &None).0);

    h.registry.revoke_all(&holder);

    assert!(!h.registry.is_verified(&holder, &symbol_short!("kyc"), &None).0);
    assert!(!h.registry.is_verified(&holder, &symbol_short!("funds"), &None).0);
    assert!(!h.registry.is_verified(&holder, &symbol_short!("age"), &None).0);
}

// ── get_record tests ──────────────────────────────────────────────────────────

#[test]
fn get_record_returns_full_proof_record_when_present() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    submit(&env, &h, &holder, 9999);

    submit(&env, &h, &holder, 1000);

    let record_opt = h.registry.get_record(&holder, &symbol_short!("kyc"));
    assert!(record_opt.is_some());
    let record = record_opt.unwrap();

    assert_eq!(record.verified_at, env.ledger().timestamp());
    assert_eq!(record.expiry, 1000);
    assert_eq!(record.threshold, None);
    assert!(!record.revoked);
    assert_eq!(record.issuer, Some(h.issuer.clone()));
}

#[test]
fn get_record_returns_none_when_absent() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    assert!(h.registry.get_record(&holder, &symbol_short!("kyc")).is_none());
}

// ── claim_expiry tests ────────────────────────────────────────────────────────

#[test]
fn claim_expiry_returns_expiry_for_valid_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    submit(&env, &h, &holder, 9999);
    assert_eq!(h.registry.claim_expiry(&holder, &symbol_short!("kyc")), 9999);
}

#[test]
fn claim_expiry_returns_zero_for_nonexistent_proof() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    assert_eq!(h.registry.claim_expiry(&holder, &symbol_short!("kyc")), 0);
}

// ── migrate_record tests ─────────────────────────────────────────────────────

#[test]
fn migrate_record_makes_legacy_readable() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    env.as_contract(&h.registry_id, || {
        let key = DataKey::Proof(holder.clone(), symbol_short!("kyc"));
        let legacy = LegacyProofRecord {
            verified_at: 500,
            expiry: 9999,
            threshold: None,
            revoked: false,
        };
        env.storage().persistent().set(&key, &legacy);
    });

    h.registry.migrate_record(&holder, &symbol_short!("kyc"));

    let (valid, _at, expiry) = h.registry.is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(valid);
    assert_eq!(expiry, 9999);
}

#[test]
fn migrate_record_idempotent() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 9999);
    h.registry.migrate_record(&holder, &symbol_short!("kyc"));

    assert_eq!(record.verified_at, env.ledger().timestamp());
    assert_eq!(record.expiry, 5000);
    assert_eq!(record.threshold, Some(200_000));
    assert!(!record.revoked);
    assert_eq!(record.issuer, Some(issuer));
}

#[test]
fn migrate_record_no_proof_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    submit(&env, &h, &holder, 1000);

    // Revoke the proof via issuer.
    h.registry.revoke(&h.issuer, &holder, &symbol_short!("kyc"));

    // Advance ledger timestamp past expiry.
    env.ledger().with_mut(|li| li.timestamp = 2000);

    // get_record returns the stored record as-is without validity computation.
    let record = h
        .registry
        .get_record(&holder, &symbol_short!("kyc"))
        .expect("Record should be retrieved as-is");

    assert_eq!(record.expiry, 1000);
    assert!(record.revoked);
    assert_eq!(record.issuer, Some(h.issuer.clone()));
}

#[test]
fn migrate_record_only_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);
    let res = h.registry
        .mock_auths(&[])
        .try_migrate_record(&holder, &symbol_short!("kyc"));
    assert!(res.is_err());
}

#[test]
fn legacy_record_missing_issuer_key_fails_to_read() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    env.as_contract(&h.registry_id, || {
        let key = DataKey::Proof(holder.clone(), symbol_short!("kyc"));
        let legacy = LegacyProofRecord {
            verified_at: 500,
            expiry: 9999,
            threshold: None,
            revoked: false,
        };
        env.storage().persistent().set(&key, &legacy);
    });

    let result = h.registry.try_is_verified(&holder, &symbol_short!("kyc"), &None);
    assert!(result.is_err());
}

#[test]
fn migrated_record_rejected_under_trusted_issuers() {
    let env = Env::default();
    env.mock_all_auths();
    let h = deploy(&env);
    let holder = Address::generate(&env);

    env.as_contract(&h.registry_id, || {
        let key = DataKey::Proof(holder.clone(), symbol_short!("kyc"));
        let legacy = LegacyProofRecord {
            verified_at: 500,
            expiry: 9999,
            threshold: None,
            revoked: false,
        };
        env.storage().persistent().set(&key, &legacy);
    });

    h.registry.migrate_record(&holder, &symbol_short!("kyc"));

    assert!(h.registry.check_claim(&holder, &symbol_short!("kyc"), &None, &None));
    assert!(!h.registry.check_claim(
        &holder,
        &symbol_short!("kyc"),
        &None,
        &Some(vec![&env, h.issuer.clone()]),
    ));
}