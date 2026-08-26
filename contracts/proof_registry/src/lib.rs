#![no_std]
//! ProofRegistry
//!
//! Caches successful verifications so protocols don't re-run the (expensive)
//! UltraHonk verifier on every interaction. A holder proves once; the registry
//! records "this address satisfies credential X until ledger time T". Any gated
//! protocol then makes a single cheap `is_verified` call.
//!
//! On `submit_proof` the registry (1) checks the named issuer is registered and
//! trusted for the credential type via IssuerRegistry, (2) forwards the proof to
//! CredentialVerifier, and only caches the result if both pass.
//!
//! `submit_proofs_batch` accepts up to 5 `ProofSubmission` entries and verifies
//! and stores all of them atomically: if any single proof fails the entire call
//! reverts, saving the holder from multiple wallet confirmations and fee payments.
//!
//! `submit_aggregate_proof` verifies a single aggregate proof covering N
//! credential types (N=2 PoC: KYC + age) and stores all claims atomically.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, Address, Bytes, BytesN, Env, Map, Symbol, Val, Vec,
};

// ── Event topic constants ────────────────────────────────────────────────────
// Topics follow the convention: (contract, action, credential_type).
// `contract` is always `symbol_short!("proof_reg")` for ProofRegistry events.
// `action`   identifies the operation.
// `credential_type` is the per-event Symbol (e.g. "kyc", "age").

/// Payload emitted when a proof is successfully verified and stored.
/// Topics: ("proof_reg", "submitted", credential_type)
#[contracttype]
#[derive(Clone)]
pub struct EventProofSubmitted {
    /// The holder whose proof was verified.
    pub holder: Address,
    /// The issuer that signed the credential.
    pub issuer: Address,
    /// The ledger timestamp at which verification was recorded.
    pub verified_at: u64,
    /// The expiry timestamp supplied by the holder.
    pub expiry: u64,
}

/// Payload emitted when an issuer revokes a holder's proof.
/// Topics: ("proof_reg", "revoked", credential_type)
#[contracttype]
#[derive(Clone)]
pub struct EventProofRevoked {
    /// The holder whose proof was revoked.
    pub holder: Address,
    /// The issuer that performed the revocation.
    pub issuer: Address,
    /// The ledger timestamp at which the revocation was recorded.
    pub revoked_at: u64,
}

/// Payload emitted when submissions are paused by admin.
/// Topics: ("proof_reg", "paused")
#[contracttype]
#[derive(Clone)]
pub struct EventPaused {
    pub admin: Address,
    pub paused_at: u64,
}

/// Payload emitted when submissions are unpaused by admin.
/// Topics: ("proof_reg", "unpaused")
#[contracttype]
#[derive(Clone)]
pub struct EventUnpaused {
    pub admin: Address,
    pub unpaused_at: u64,
}

// Persistent-entry lifetime management (~5s ledgers). Persistent storage rent
// is charged for the requested lifetime; entries whose TTL reaches zero are
// archived and no longer readable. Claims therefore keep a 90-day minimum,
// extend through credential expiry when possible, and remain bounded by the
// network's maximum entry TTL.
const DAY_IN_LEDGERS: u32 = 17280;
const SECONDS_PER_LEDGER: u64 = 5;
const PROOF_BUMP_THRESHOLD: u32 = DAY_IN_LEDGERS;
const PROOF_TTL: u32 = 90 * DAY_IN_LEDGERS;

/// Maximum number of submissions accepted by `submit_proofs_batch`.
const MAX_BATCH_SIZE: u32 = 5;

// ── Expiry validation constants ──────────────────────────────────────────────
/// Minimum expiry in the future (seconds) required for a new proof. This
/// prevents trivial "already expired" submissions and gives the holder at
/// least 1 hour of validity.
const MIN_EXPIRY_SECONDS_AHEAD: u64 = 3600;

/// Maximum expiry in the future (seconds) allowed for a new proof. Caps a
/// malicious/buggy holder from minting effectively-never-expiring credentials.
/// 366 days is generous enough for any real credential while keeping the
/// on-chain cache bounded.
const MAX_EXPIRY_SECONDS_AHEAD: u64 = 366 * 24 * 3600;

// ── Aggregate proof public-input layout (N=2: KYC + age) ────────────────────
// The aggregate_proof circuit packs N credential public inputs sequentially,
// followed by num_credentials as the last field.
//
// KYC (65 fields): commitment(1) + issuer_x(32) + issuer_y(32)
// Age  (67 fields): commitment(1) + issuer_x(32) + issuer_y(32) +
//                    current_date(1) + threshold_years(1)
//
// Field indices (0-based) within public_inputs:
const AGG_FIELD_KYC_START: u32 = 0;
const AGG_FIELD_KYC_PUBKEY: u32 = 1;
const AGG_FIELD_AGE_START: u32 = 65;
const AGG_FIELD_AGE_PUBKEY: u32 = 66;
const AGG_FIELD_AGE_THRESHOLD: u32 = 131; // AGG_FIELD_AGE_START(65)+1+32+32+1=131
const AGG_FIELD_NUM_CREDENTIALS: u32 = 132;

/// Typed client for the deployed CredentialVerifier contract. Declared as an
/// interface (not a crate dependency) so this contract links only the client,
/// never the verifier's exported wasm symbols.
#[contractclient(name = "VerifierClient")]
pub trait VerifierInterface {
    fn verify_proof(env: Env, credential_type: Symbol, proof: Bytes, public_inputs: Bytes, vk_version: Option<u32>) -> bool;
}

/// Typed client for the deployed IssuerRegistry contract.
#[contractclient(name = "IssuerClient")]
pub trait IssuerRegistryInterface {
    fn is_valid_issuer(env: Env, issuer_id: Address, credential_type: Symbol) -> bool;
    fn get_issuer_pubkey(env: Env, issuer_id: Address) -> BytesN<64>;
}

// Public-input layout (each field is 32 bytes, big-endian): field 0 is the
// commitment, fields 1..33 are issuer_x bytes (one byte per field, in the low
// byte), fields 33..65 are issuer_y bytes. The signed public key therefore
// occupies bytes 32..2080 of `public_inputs`.
const PUBKEY_START_FIELD: u32 = 1;
const FIELD_BYTES: u32 = 32;

#[contracttype]
#[derive(Clone)]
pub struct ProofRecord {
    pub verified_at: u64,
    pub expiry: u64,
    /// For parameterised credential types (age, income, funds), the threshold
    /// value that was committed to in the proof's public inputs. None for types
    /// with no numeric threshold (kyc, jurisdiction).
    pub threshold: Option<u64>,
    /// Set by the registered issuer via `revoke`. Expiry data is kept for audit.
    pub revoked: bool,
    /// The issuer that signed the credential this proof was verified against.
    /// Lets a protocol restrict which issuers it trusts per claim type via
    /// `trusted_issuers` on `is_verified` / `check_claim`.
    ///
    /// `Option` so `issuer` can be explicitly absent within an
    /// already-current-shape record (e.g. one written by a future migration
    /// that can't recover the original issuer) — `issuer_is_trusted` then
    /// fails closed and rejects it under an active `trusted_issuers` filter,
    /// since there's no issuer to check against (a filterless caller is
    /// unaffected either way). This does NOT, by itself, make a record
    /// written before this field existed readable: Soroban's struct decoding
    /// requires the stored map's entry count to exactly match the current
    /// struct's field count, so those records still fail to deserialize (see
    /// `legacy_record_missing_issuer_key_fails_to_read` in test.rs). A real
    /// migration is required before redeploying over existing stored proofs.
    pub issuer: Option<Address>,
    /// VK version the proof was verified against at submission time.
    /// `0` is the sentinel for "latest at submission time" (the caller passed
    /// `vk_version = None` and the verifier resolved the newest version).
    /// Stored so a proof submitted against an older circuit version remains
    /// auditable — and valid — after the circuit is upgraded.
    pub vk_version: u32,
}

/// A legacy 4-field record shape from before `ProofRecord` gained the `issuer`
/// field (and later the `vk_version` field). Used by `migrate_record` to read
/// records stored under the old schema and rewrite them into the current
/// 6-field `ProofRecord` layout.
#[contracttype]
#[derive(Clone)]
pub struct LegacyProofRecord {
    pub verified_at: u64,
    pub expiry: u64,
    pub threshold: Option<u64>,
    pub revoked: bool,
}

/// A single proof submission inside a batch. Mirrors the individual parameters
/// of `submit_proof` but grouped into a struct so they can be passed as a `Vec`.
#[contracttype]
#[derive(Clone)]
pub struct ProofSubmission {
    pub credential_type: Symbol,
    pub proof: Bytes,
    pub public_inputs: Vec<u32>,
    pub issuer_id: Address,
    pub expiry: u64,
    /// VK version to use for verification. `None` defaults to the latest
    /// registered version (recommended for new submissions).
    pub vk_version: Option<u32>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Verifier,
    IssuerRegistry,
    Paused,
    /// Cached verification, keyed by (holder, credential_type).
    Proof(Address, Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    VerificationFailed = 2,
    NotAuthorized = 3,
    IssuerNotTrusted = 4,
    /// The public key the proof was made against does not match the registered
    /// issuer's key.
    IssuerKeyMismatch = 5,
    ProofNotFound = 6,
    /// The batch contains more than `MAX_BATCH_SIZE` submissions.
    BatchTooLarge = 7,
    /// The batch must contain at least one submission.
    BatchEmpty = 8,
    /// Two or more submissions in the batch share the same `credential_type`;
    /// only the last write would survive, so the batch is rejected outright.
    DuplicateCredentialType = 9,
    /// The aggregate proof's num_credentials field doesn't match the expected
    /// count or the inner public inputs are too short.
    AggregateLayoutInvalid = 10,
    /// New submissions are temporarily halted by admin.
    SubmissionsPaused = 11,
    /// The holder-supplied expiry is too soon (already expired or expires
    /// within `MIN_EXPIRY_SECONDS_AHEAD`).
    ExpiryTooSoon = 12,
    /// The holder-supplied expiry is too far in the future (exceeds
    /// `MAX_EXPIRY_SECONDS_AHEAD`).
    ExpiryTooFar = 13,
    /// The number of expiries doesn't match the number of credential types in
    /// an aggregate submission.
    ExpiryCountMismatch = 14,
}

#[contract]
pub struct ProofRegistry;

fn vec_u32_to_bytes(env: &Env, vec: &Vec<u32>) -> Bytes {
    let mut bytes = Bytes::new(env);
    for val in vec.iter() {
        bytes.append(&Bytes::from_array(env, &val.to_be_bytes()));
    }
    bytes
}

#[contractimpl]
impl ProofRegistry {
    /// `admin`, `verifier` and `issuer_registry` are the deployed contract addresses.
    pub fn __constructor(env: Env, admin: Address, verifier: Address, issuer_registry: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage()
            .instance()
            .set(&DataKey::IssuerRegistry, &issuer_registry);
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    #[allow(deprecated)]
    pub fn pause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &true);
        env.events().publish(
            (symbol_short!("proof_reg"), symbol_short!("paused")),
            EventPaused {
                admin,
                paused_at: env.ledger().timestamp(),
            },
        );
    }

    #[allow(deprecated)]
    pub fn unpause(env: Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();
        env.storage().instance().set(&DataKey::Paused, &false);
        env.events().publish(
            (symbol_short!("proof_reg"), symbol_short!("unpaused")),
            EventUnpaused {
                admin,
                unpaused_at: env.ledger().timestamp(),
            },
        );
    }

    /// Verify a proof and, if valid, cache it for `holder` until `expiry`
    /// (ledger timestamp, seconds). The holder authorizes their own submission.
    /// `issuer_id` must be registered and trusted for `credential_type`.
    #[allow(deprecated)]
    pub fn submit_proof(
        env: Env,
        holder: Address,
        issuer_id: Address,
        credential_type: Symbol,
        proof: Bytes,
        public_inputs: Bytes,
        vk_version: Option<u32>,
        expiry: u64,
    ) {
        holder.require_auth();
        Self::ensure_not_paused(&env);
        Self::validate_expiry(&env, expiry);

        // 1. The named issuer must be trusted for this credential type.
        let registry = IssuerClient::new(&env, &Self::issuer_registry(&env));
        if !registry.is_valid_issuer(&issuer_id, &credential_type) {
            panic_with_error!(&env, Error::IssuerNotTrusted);
        }

        // 2. The public key the proof attests to (in its public inputs) must be
        //    the registered issuer's key.
        let expected = registry.get_issuer_pubkey(&issuer_id);
        if !Self::public_inputs_match_pubkey(&public_inputs, &expected) {
            panic_with_error!(&env, Error::IssuerKeyMismatch);
        }

        // 3. The proof must verify against the registered VK for this type.
        let verifier = VerifierClient::new(&env, &Self::verifier(&env));
        if !verifier.verify_proof(&credential_type, &proof, &public_inputs, &vk_version) {
            panic_with_error!(&env, Error::VerificationFailed);
        }

        let key = DataKey::Proof(holder.clone(), credential_type.clone());
        let record = ProofRecord {
            verified_at: env.ledger().timestamp(),
            expiry,
            threshold: Self::extract_threshold(&env, &credential_type, &public_inputs),
            revoked: false,
            issuer: Some(issuer_id),
            // 0 = "latest at submission time" (see ProofRecord::vk_version).
            vk_version: vk_version.unwrap_or(0),
        };
        env.storage().persistent().set(&key, &record);
        Self::bump_ttl(&env, &key, expiry);

        // Emit: topics = ("proof_reg", "submitted", credential_type)
        //       data   = EventProofSubmitted { holder, issuer, verified_at, expiry }
        env.events().publish(
            (
                symbol_short!("proof_reg"),
                symbol_short!("submitted"),
                credential_type,
            ),
            EventProofSubmitted {
                holder,
                issuer: record.issuer.unwrap(),
                verified_at: record.verified_at,
                expiry: record.expiry,
            },
        );
    }

    /// One event is emitted per successfully verified credential.
    /// Topics: ("proof_reg", "submitted", credential_type)
    /// Data:   EventProofSubmitted { holder, issuer, verified_at, expiry }
    #[allow(deprecated)]
    pub fn submit_proofs(env: Env, holder: Address, submissions: Vec<ProofSubmission>) -> Vec<bool> {
        holder.require_auth();
        Self::ensure_not_paused(&env);

        let len = submissions.len();
        if len == 0 {
            panic_with_error!(&env, Error::BatchEmpty);
        }
        if len > MAX_BATCH_SIZE {
            panic_with_error!(&env, Error::BatchTooLarge);
        }

        // Guard: reject batches with duplicate credential_type entries.
        for i in 0..len {
            for j in (i + 1)..len {
                if submissions.get(i).unwrap().credential_type
                    == submissions.get(j).unwrap().credential_type
                {
                    panic_with_error!(&env, Error::DuplicateCredentialType);
                }
            }
        }

        // Validate all expiries before any verification work.
        for sub in submissions.iter() {
            Self::validate_expiry(&env, sub.expiry);
        }

        let issuer_registry_addr = Self::issuer_registry(&env);
        let verifier_addr = Self::verifier(&env);
        let registry = IssuerClient::new(&env, &issuer_registry_addr);
        let verifier = VerifierClient::new(&env, &verifier_addr);

        let now = env.ledger().timestamp();

        for sub in submissions.iter() {
            let public_inputs_bytes = vec_u32_to_bytes(&env, &sub.public_inputs);

            if !registry.is_valid_issuer(&sub.issuer_id, &sub.credential_type) {
                panic_with_error!(&env, Error::IssuerNotTrusted);
            }

            let expected = registry.get_issuer_pubkey(&sub.issuer_id);
            if !Self::public_inputs_match_pubkey(&public_inputs_bytes, &expected) {
                panic_with_error!(&env, Error::IssuerKeyMismatch);
            }

            if !verifier.verify_proof(
                &sub.credential_type,
                &sub.proof,
                &public_inputs_bytes,
                &sub.vk_version,
            ) {
                panic_with_error!(&env, Error::VerificationFailed);
            }

            let key = DataKey::Proof(holder.clone(), sub.credential_type.clone());
            let effective_version = sub.vk_version.unwrap_or(0);
            let record = ProofRecord {
                verified_at: now,
                expiry: sub.expiry,
                threshold: Self::extract_threshold(&env, &sub.credential_type, &public_inputs_bytes),
                revoked: false,
                issuer: Some(sub.issuer_id.clone()),
                vk_version: effective_version,
            };
            env.storage().persistent().set(&key, &record);
            Self::bump_ttl(&env, &key, sub.expiry);

            // Emit one event per credential.
            env.events().publish(
                (
                    symbol_short!("proof_reg"),
                    symbol_short!("submitted"),
                    sub.credential_type.clone(),
                ),
                EventProofSubmitted {
                    holder: holder.clone(),
                    issuer: record.issuer.clone().unwrap(),
                    verified_at: record.verified_at,
                    expiry: record.expiry,
                },
            );
        }

        let mut results = Vec::new(&env);
        for _ in 0..len {
            results.push_back(true);
        }
        results
    }

    /// Verify an aggregate proof that bundles N credential proofs into a single
    /// UltraHonk proof, and atomically store all N claims. This reduces on-chain
    /// verification from N separate `submit_proof` calls to 1.
    ///
    /// The aggregate circuit (N=2 PoC: KYC + age) packs the public inputs as:
    ///   [kyc_fields(65) | age_fields(67) | num_credentials(1)] = 133 fields.
    /// Each inner credential's issuer must be independently registered and
    /// trusted for its credential type; the outer proof must verify against
    /// the "aggregate" VK registered on the CredentialVerifier.
    ///
    /// `expiries` supplies a per-credential expiry timestamp (ledger seconds).
    /// This replaces the previous single-shared-expiry behaviour: different
    /// credential types legitimately have different validity windows (e.g. a
    /// short-lived funds attestation vs a long-lived KYC), and validating each
    /// one independently prevents an aggregate from minting never-expiring
    /// credentials.
    ///
    /// Emits one "submitted" event per stored credential, mirroring
    /// `submit_proofs_batch`.
    #[allow(deprecated)]
    pub fn submit_aggregate_proof(
        env: Env,
        holder: Address,
        issuer_ids: Vec<Address>,
        credential_types: Vec<Symbol>,
        proof: Bytes,
        public_inputs: Bytes,
        expiries: Vec<u64>,
    ) {
        holder.require_auth();
        Self::ensure_not_paused(&env);

        // 1. Verify the outer aggregate proof against the aggregate VK. The
        //    aggregate circuit has no version parameter; always resolve the
        //    latest registered VK (`None`).
        let verifier = VerifierClient::new(&env, &Self::verifier(&env));
        if !verifier.verify_proof(&symbol_short!("aggregate"), &proof, &public_inputs, &None) {
            panic_with_error!(&env, Error::VerificationFailed);
        }

        // 2. Validate the layout: the num_credentials field (last public-input
        //    field) must match the supplied type count, and the issuer/type/
        //    expiry vectors must all be the same length.
        let num = Self::read_u64_field(&public_inputs, AGG_FIELD_NUM_CREDENTIALS);
        if num != credential_types.len() as u64
            || num < 2
            || num > MAX_BATCH_SIZE as u64
            || issuer_ids.len() != credential_types.len()
            || expiries.len() != credential_types.len()
        {
            panic_with_error!(&env, Error::AggregateLayoutInvalid);
        }

        // 3. Validate every expiry BEFORE any storage writes. Each credential
        //    gets its own validated expiry; a bad value anywhere reverts the
        //    whole aggregate.
        for expiry in expiries.iter() {
            Self::validate_expiry(&env, expiry);
        }

        let registry = IssuerClient::new(&env, &Self::issuer_registry(&env));
        let now = env.ledger().timestamp();

        // 4. For each inner credential, validate issuer trust and pubkey, then
        //    atomically store the claim with its own expiry.
        let mut field_offset: u32 = 0;
        for i in 0..credential_types.len() {
            let ct = credential_types.get(i).unwrap();
            let issuer = issuer_ids.get(i).unwrap();
            let expiry = expiries.get(i).unwrap();

            if !registry.is_valid_issuer(&issuer, &ct) {
                panic_with_error!(&env, Error::IssuerNotTrusted);
            }

            // Pubkey sits at (commitment field + 1) relative to the block start.
            let expected = registry.get_issuer_pubkey(&issuer);
            if !Self::aggregate_pubkey_match(&public_inputs, field_offset + 1, &expected) {
                panic_with_error!(&env, Error::IssuerKeyMismatch);
            }

            let threshold =
                Self::extract_threshold_from_aggregate(&ct, &public_inputs, field_offset);
            Self::store_claim(&env, &holder, &ct, now, expiry, threshold, issuer.clone());

            // Emit one event per stored credential.
            env.events().publish(
                (
                    symbol_short!("proof_reg"),
                    symbol_short!("submitted"),
                    ct.clone(),
                ),
                EventProofSubmitted {
                    holder: holder.clone(),
                    issuer: issuer.clone(),
                    verified_at: now,
                    expiry,
                },
            );

            field_offset += Self::aggregate_field_count(&ct);
        }
    }

    /// Returns `(is_currently_valid, verified_at, expiry)`. `is_currently_valid`
    /// accounts for expiry against the current ledger time.
    pub fn is_verified(
        env: Env,
        holder: Address,
        credential_type: Symbol,
        trusted_issuers: Option<Vec<Address>>,
    ) -> (bool, u64, u64) {
        match env
            .storage()
            .persistent()
            .get::<_, ProofRecord>(&DataKey::Proof(holder, credential_type))
        {
            Some(r) => {
                let valid = !r.revoked
                    && r.expiry > env.ledger().timestamp()
                    && Self::issuer_is_trusted(&trusted_issuers, &r.issuer);
                (valid, r.verified_at, r.expiry)
            }
            None => (false, 0, 0),
        }
    }

    /// Like `is_verified` but also enforces a minimum threshold.
    pub fn check_claim(
        env: Env,
        holder: Address,
        credential_type: Symbol,
        min_threshold: Option<u64>,
        trusted_issuers: Option<Vec<Address>>,
    ) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, ProofRecord>(&DataKey::Proof(holder, credential_type))
        {
            Some(r) => {
                if r.revoked || r.expiry <= env.ledger().timestamp() {
                    return false;
                }
                if !Self::issuer_is_trusted(&trusted_issuers, &r.issuer) {
                    return false;
                }
                match min_threshold {
                    None => true,
                    Some(min) => r.threshold.unwrap_or(0) >= min,
                }
            }
            None => false,
        }
    }

    /// Returns the stored `ProofRecord` as-is.
    pub fn get_record(
        env: Env,
        holder: Address,
        credential_type: Symbol,
    ) -> Option<ProofRecord> {
        env.storage()
            .persistent()
            .get::<_, ProofRecord>(&DataKey::Proof(holder, credential_type))
    }

    /// Returns the expiry for `holder`'s cached proof.
    pub fn claim_expiry(env: Env, holder: Address, credential_type: Symbol) -> u64 {
        let key = DataKey::Proof(holder, credential_type);
        let record = env.storage().persistent().get::<_, ProofRecord>(&key);
        if let Some(ref record) = record {
            Self::bump_ttl(&env, &key, record.expiry);
        }
        record.map(|r| r.expiry).unwrap_or(0)
    }

    /// Extend a still-valid claim's persistent storage entry.
    pub fn bump_claim(env: Env, holder: Address, credential_type: Symbol) {
        let key = DataKey::Proof(holder, credential_type);
        let record: ProofRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProofNotFound));
        if record.revoked || record.expiry <= env.ledger().timestamp() {
            panic_with_error!(&env, Error::ProofNotFound);
        }
        Self::bump_ttl(&env, &key, record.expiry);
    }

    fn issuer_is_trusted(trusted_issuers: &Option<Vec<Address>>, issuer: &Option<Address>) -> bool {
        match trusted_issuers {
            None => true,
            Some(list) => match issuer {
                None => false,
                Some(addr) => list.contains(addr),
            },
        }
    }

    /// Revoke a cached proof.
    pub fn revoke_proof(env: Env, holder: Address, credential_type: Symbol) {
        holder.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Proof(holder, credential_type));
    }

    /// Revoke ALL cached proofs for a holder.
    pub fn revoke_all(env: Env, holder: Address) {
        holder.require_auth();
        let types = [
            symbol_short!("kyc"),
            symbol_short!("age"),
            symbol_short!("income"),
            Symbol::new(&env, "jurisdiction"),
            symbol_short!("funds"),
            Symbol::new(&env, "accreditation"),
            Symbol::new(&env, "employment"),
        ];
        for t in types {
            env.storage()
                .persistent()
                .remove(&DataKey::Proof(holder.clone(), t));
        }
    }

    /// Invalidate a holder's cached proof.
    #[allow(deprecated)]
    pub fn revoke(env: Env, issuer: Address, holder: Address, credential_type: Symbol) {
        issuer.require_auth();

        let registry = IssuerClient::new(&env, &Self::issuer_registry(&env));
        if !registry.is_valid_issuer(&issuer, &credential_type) {
            panic_with_error!(&env, Error::IssuerNotTrusted);
        }

        let key = DataKey::Proof(holder.clone(), credential_type.clone());
        let mut record: ProofRecord = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProofNotFound));
        record.revoked = true;
        env.storage().persistent().set(&key, &record);
        env.storage()
            .persistent()
            .extend_ttl(&key, PROOF_BUMP_THRESHOLD, PROOF_TTL);

        #[allow(deprecated)]
        env.events().publish(
            (
                symbol_short!("proof_reg"),
                symbol_short!("revoked"),
                credential_type,
            ),
            EventProofRevoked {
                holder,
                issuer,
                revoked_at: env.ledger().timestamp(),
            },
        );
    }

    /// Admin-only migration from legacy to current layout.
    pub fn migrate_record(env: Env, holder: Address, credential_type: Symbol) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized));
        admin.require_auth();

        let key = DataKey::Proof(holder.clone(), credential_type.clone());

        let raw_map: Map<Symbol, Val> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::ProofNotFound));

        if raw_map.len() == 4 {
            let legacy: LegacyProofRecord = env
                .storage()
                .persistent()
                .get(&key)
                .unwrap();

            let record = ProofRecord {
                verified_at: legacy.verified_at,
                expiry: legacy.expiry,
                threshold: legacy.threshold,
                revoked: legacy.revoked,
                issuer: None,
                vk_version: 0,
            };
            env.storage().persistent().set(&key, &record);
            Self::bump_ttl(&env, &key, record.expiry);
        }
    }

    pub fn verifier_address(env: Env) -> Address {
        Self::verifier(&env)
    }

    pub fn issuer_registry_address(env: Env) -> Address {
        Self::issuer_registry(&env)
    }

    /// Validate a holder-supplied expiry: must be at least
    /// `MIN_EXPIRY_SECONDS_AHEAD` in the future and at most
    /// `MAX_EXPIRY_SECONDS_AHEAD`.
    fn validate_expiry(env: &Env, expiry: u64) {
        let now = env.ledger().timestamp();
        if expiry <= now.saturating_add(MIN_EXPIRY_SECONDS_AHEAD) {
            panic_with_error!(env, Error::ExpiryTooSoon);
        }
        if expiry > now.saturating_add(MAX_EXPIRY_SECONDS_AHEAD) {
            panic_with_error!(env, Error::ExpiryTooFar);
        }
    }

    /// Extract the numeric threshold from the proof's public inputs.
    fn extract_threshold(env: &Env, credential_type: &Symbol, public_inputs: &Bytes) -> Option<u64> {
        if *credential_type == symbol_short!("age") {
            Some(Self::read_u64_field(public_inputs, 66))
        } else if *credential_type == symbol_short!("income")
            || *credential_type == symbol_short!("funds")
            || *credential_type == Symbol::new(env, "accreditation")
            || *credential_type == Symbol::new(env, "employment")
        {
            Some(Self::read_u64_field(public_inputs, 65))
        } else {
            None
        }
    }

    /// Read a big-endian u64 from the last 8 bytes of a 32-byte field element.
    fn read_u64_field(public_inputs: &Bytes, field_index: u32) -> u64 {
        let base = field_index * FIELD_BYTES;
        let mut b = [0u8; 8];
        for i in 0..8 {
            b[i] = public_inputs.get(base + 24 + i);
        }
    }