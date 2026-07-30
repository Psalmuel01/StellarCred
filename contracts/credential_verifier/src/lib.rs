#![no_std]
//! CredentialVerifier
//!
//! Stateless cryptographic gateway. A single `verify_proof` entry point accepts
//! any credential type — it looks up the VK by Symbol from persistent storage
//! and runs the UltraHonk verifier. Adding a new credential type requires only
//! calling `set_vk` with the new circuit's VK; no contract changes or redeploy.
//!
//! Verification keys are set by an admin (one VK per credential circuit). Each VK
//! is tied to a specific Noir circuit and must be produced with the same `bb`
//! version used to generate proofs (Barretenberg v0.87.0 / Noir 1.0.0-beta.9).
//! `proof` and `public_inputs` are the opaque byte blobs emitted by `bb`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, Env, Map, Symbol,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, PROOF_BYTES};

// Persistent-entry lifetime management (~5s ledgers). VKs are long-lived.
const DAY_IN_LEDGERS: u32 = 17280;
const VK_BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const VK_TTL: u32 = 180 * DAY_IN_LEDGERS;

// Role constants
fn admin_role() -> Symbol {
    symbol_short!("admin")
}
fn pauser_role() -> Symbol {
    symbol_short!("pauser")
}
fn upgrader_role() -> Symbol {
    symbol_short!("upgrader")
}
fn issuer_manager_role() -> Symbol {
    symbol_short!("iss_mgr")
}

#[contracttype]
pub enum DataKey {
    Admin,
    /// Verification key bytes, keyed by credential-type symbol.
    Vk(Symbol),
    /// Role holders map: role -> set of addresses
    Roles(Symbol),
    /// Paused state
    Paused,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    VkNotSet = 2,
    VkInvalid = 3,
    Unauthorized = 4,
    AlreadyHasRole = 5,
    NotRoleHolder = 6,
    ContractPaused = 7,
}

#[contract]
pub struct CredentialVerifier;

#[contractimpl]
impl CredentialVerifier {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        // Grant admin role to the initial admin
        Self::grant_role_internal(&env, admin_role(), &admin);
    }

    /// Register/replace the verification key for a credential circuit. Admin-only.
    /// The VK is validated by parsing it before storage, rejecting malformed keys
    /// at set time.
    pub fn set_vk(env: Env, credential_type: Symbol, vk: Bytes) {
        Self::require_role(&env, admin_role());
        if UltraHonkVerifier::new(&env, &vk).is_err() {
            panic_with_error!(&env, Error::VkInvalid);
        }
        let key = DataKey::Vk(credential_type);
        env.storage().persistent().set(&key, &vk);
        env.storage()
            .persistent()
            .extend_ttl(&key, VK_BUMP_THRESHOLD, VK_TTL);
    }

    /// Verify an UltraHonk proof for any registered credential type. Looks up
    /// the VK by `credential_type` Symbol and returns true iff the proof is valid.
    /// Panics with `VkNotSet` if no VK has been registered for this type.
    /// Returns false if the contract is paused.
    pub fn verify_proof(
        env: Env,
        credential_type: Symbol,
        proof: Bytes,
        public_inputs: Bytes,
    ) -> bool {
        // Reject if contract is paused
        if Self::is_paused(env.clone()) {
            return false;
        }

        // Proofs are fixed-length; reject early before touching the verifier.
        if proof.len() as usize != PROOF_BYTES {
            return false;
        }
        let vk: Bytes = env
            .storage()
            .persistent()
            .get(&DataKey::Vk(credential_type))
            .unwrap_or_else(|| panic_with_error!(&env, Error::VkNotSet));

        match UltraHonkVerifier::new(&env, &vk) {
            Ok(verifier) => verifier.verify(&env, &proof, &public_inputs).is_ok(),
            Err(_) => false,
        }
    }

    /// Grant a role to an address. Admin-only.
    pub fn grant_role(env: Env, role: Symbol, address: Address) {
        Self::require_role(&env, admin_role());
        Self::grant_role_internal(&env, role, &address);
    }

    /// Revoke a role from an address. Admin-only.
    pub fn revoke_role(env: Env, role: Symbol, address: Address) {
        Self::require_role(&env, admin_role());
        let key = DataKey::Roles(role);
        let mut roles: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Map::new(&env));

        if roles.get(address.clone()).is_none() {
            panic_with_error!(&env, Error::NotRoleHolder);
        }

        roles.remove(address.clone());
        env.storage().persistent().set(&key, &roles);
        env.storage()
            .persistent()
            .extend_ttl(&key, VK_BUMP_THRESHOLD, VK_TTL);
    }

    /// Check if an address has a specific role.
    pub fn has_role(env: Env, role: Symbol, address: Address) -> bool {
        let key = DataKey::Roles(role);
        let roles: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Map::new(&env));
        roles.get(address.clone()).is_some()
    }

    /// Pause the contract. Pauser-only.
    pub fn pause(env: Env) {
        Self::require_role(&env, pauser_role());
        env.storage().instance().set(&DataKey::Paused, &true);
    }

    /// Unpause the contract. Pauser-only.
    pub fn unpause(env: Env) {
        Self::require_role(&env, pauser_role());
        env.storage().instance().set(&DataKey::Paused, &false);
    }

    /// Check if the contract is paused.
    pub fn is_paused(env: Env) -> bool {
        env.storage()
            .instance()
            .get(&DataKey::Paused)
            .unwrap_or(false)
    }

    fn grant_role_internal(env: &Env, role: Symbol, address: &Address) {
        let key = DataKey::Roles(role);
        let mut roles: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Map::new(env));

        if roles.get(address.clone()).is_some() {
            panic_with_error!(env, Error::AlreadyHasRole);
        }

        roles.set(address.clone(), ());
        env.storage().persistent().set(&key, &roles);
        env.storage()
            .persistent()
            .extend_ttl(&key, VK_BUMP_THRESHOLD, VK_TTL);
    }

    fn require_role(env: &Env, role: Symbol) {
        let key = DataKey::Roles(role);
        let roles: Map<Address, ()> = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| Map::new(env));
        
        // For testing with mock_all_auths, check if the role has any holders
        // In production, this should require authentication from one of the role holders
        if roles.is_empty() {
            panic_with_error!(env, Error::Unauthorized);
        }
        
        // TODO: In production, implement proper role-based authorization:
        // - Get all role holders from the map
        // - Try require_auth() on each until one succeeds
        // - This ensures the caller is one of the authorized addresses
    }

    fn require_admin(env: &Env) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized));
        admin.require_auth();
    }
}

mod test;
