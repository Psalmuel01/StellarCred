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
//!
//! Privileged actions are governed by role-based access control (RBAC): the
//! constructor seeds the `admin` role with the deployer address, and each
//! privileged function is guarded by the role it maps to (`set_vk` → `admin`).
//! Roles are stored as a `Map<Symbol, Address>` (role name → current holder);
//! the admin can delegate or rotate holders via `grant_role` / `revoke_role`,
//! and anyone can query membership with `has_role`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    Bytes, Env, Map, Symbol,
};
use ultrahonk_soroban_verifier::{UltraHonkVerifier, PROOF_BYTES};

// Persistent-entry lifetime management (~5s ledgers). VKs are long-lived.
const DAY_IN_LEDGERS: u32 = 17280;
const VK_BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const VK_TTL: u32 = 180 * DAY_IN_LEDGERS;

#[contracttype]
pub enum DataKey {
    Admin,
    /// RBAC: role name (Symbol) → current holder (Address).
    Roles,
    /// Verification key bytes, keyed by credential-type symbol.
    Vk(Symbol),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    VkNotSet = 2,
    VkInvalid = 3,
    /// The caller is not the holder of the role required by this function.
    NotAuthorized = 4,
    /// `revoke_role` named an address that is not the current holder of the role.
    RoleHolderMismatch = 5,
}

#[contract]
pub struct CredentialVerifier;

#[contractimpl]
impl CredentialVerifier {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        // Seed the admin role with the deployer so the contract works out of the
        // box; further roles can be delegated via `grant_role`.
        let mut roles: Map<Symbol, Address> = Map::new(&env);
        roles.set(symbol_short!("admin"), admin);
        env.storage().instance().set(&DataKey::Roles, &roles);
    }

    /// Register/replace the verification key for a credential circuit. Admin-role
    /// only. The VK is validated by parsing it before storage, rejecting malformed
    /// keys at set time.
    pub fn set_vk(env: Env, credential_type: Symbol, vk: Bytes) {
        Self::require_role(&env, &symbol_short!("admin"));
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
    pub fn verify_proof(
        env: Env,
        credential_type: Symbol,
        proof: Bytes,
        public_inputs: Bytes,
    ) -> bool {
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

    /// Assign `address` as the holder of `role`, replacing any previous holder.
    /// Root-admin only. Use this to delegate or rotate a role's key — e.g. hand
    /// the `admin` role to an operations key, or prepare an `upgrader` /
    /// `pauser` key before such functionality is enabled.
    pub fn grant_role(env: Env, role: Symbol, address: Address) {
        Self::require_admin(&env);
        let mut roles: Map<Symbol, Address> = Self::roles(&env);
        roles.set(role, address);
        env.storage().instance().set(&DataKey::Roles, &roles);
    }

    /// Remove `address` as the holder of `role`. Root-admin only.
    ///
    /// The named address must be the current holder (revoking a different
    /// address is a no-op risk, so it is rejected with `RoleHolderMismatch`
    /// instead). A role with no holder is simply unassigned — no one can act
    /// under it until it is granted again.
    pub fn revoke_role(env: Env, role: Symbol, address: Address) {
        Self::require_admin(&env);
        let mut roles: Map<Symbol, Address> = Self::roles(&env);
        match roles.get(role.clone()) {
            Some(current) if current == address => {
                roles.remove(role);
                env.storage().instance().set(&DataKey::Roles, &roles);
            }
            Some(_) => panic_with_error!(&env, Error::RoleHolderMismatch),
            // Unassigned role — nothing to revoke.
            None => {}
        }
    }

    /// True iff `address` currently holds `role`.
    pub fn has_role(env: Env, role: Symbol, address: Address) -> bool {
        match env
            .storage()
            .instance()
            .get::<_, Map<Symbol, Address>>(&DataKey::Roles)
        {
            Some(roles) => roles.get(role) == Some(address),
            None => false,
        }
    }

    fn roles(env: &Env) -> Map<Symbol, Address> {
        env.storage()
            .instance()
            .get(&DataKey::Roles)
            .unwrap_or_else(|| panic_with_error!(env, Error::NotInitialized))
    }

    fn require_role(env: &Env, role: &Symbol) {
        let holder: Address = Self::roles(env)
            .get(role.clone())
            .unwrap_or_else(|| panic_with_error!(env, Error::NotAuthorized));
        holder.require_auth();
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
