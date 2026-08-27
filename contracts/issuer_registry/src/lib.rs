#![no_std]
//! IssuerRegistry
//!
//! Stores which issuers are trusted for which credential types. This is the
//! root of trust for the whole system: any verifier contract can query it to
//! learn an issuer's credential-signing public key, and any issuer can be
//! registered or revoked by the protocol admin (later: a DAO).
//!
//! Credential types are represented as short `Symbol`s, e.g. `kyc`, `age`,
//! `jurisdiction`, `income`, `human`, `employer`.
//!
//! Privileged actions are governed by role-based access control (RBAC): the
//! constructor seeds the `admin` role with the deployer address, and issuer
//! registration / revocation is guarded by that role. Roles are stored as a
//! `Map<Symbol, Address>` (role name → current holder); the root admin can
//! delegate or rotate holders via `grant_role` / `revoke_role`, and anyone can
//! query membership with `has_role`.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, Address,
    BytesN, Env, Map, Symbol, Vec,
};

// Persistent-entry lifetime management (~5s ledgers).
const DAY_IN_LEDGERS: u32 = 17280;
const BUMP_THRESHOLD: u32 = 30 * DAY_IN_LEDGERS;
const ENTRY_TTL: u32 = 120 * DAY_IN_LEDGERS;

#[contracttype]
#[derive(Clone)]
pub struct Issuer {
    /// secp256k1 public key (x || y, 32 bytes each) the issuer signs credentials
    /// with. A proof carries this key as a public input; ProofRegistry checks it
    /// matches this registered value, so a proof can only pass if a registered
    /// issuer actually signed the credential commitment.
    pub pubkey: BytesN<64>,
    /// Credential types this issuer is trusted to attest.
    pub credential_types: Vec<Symbol>,
    pub revoked: bool,
}

#[contracttype]
pub enum DataKey {
    Admin,
    /// RBAC: role name (Symbol) → current holder (Address).
    Roles,
    Issuer(Address),
    /// Append-only list of registered issuer addresses for enumeration.
    IssuerList,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Error {
    NotInitialized = 1,
    IssuerNotFound = 2,
    /// The caller is not the holder of the role required by this function.
    NotAuthorized = 3,
    /// `revoke_role` named an address that is not the current holder of the role.
    RoleHolderMismatch = 4,
}

#[contract]
pub struct IssuerRegistry;

#[contractimpl]
impl IssuerRegistry {
    /// Set the protocol admin once, at deploy time.
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
        // Seed the admin role with the deployer so the contract works out of the
        // box; further roles can be delegated via `grant_role`.
        let mut roles: Map<Symbol, Address> = Map::new(&env);
        roles.set(symbol_short!("admin"), admin);
        env.storage().instance().set(&DataKey::Roles, &roles);
    }

    /// Register (or overwrite) a trusted issuer. Admin-role only.
    pub fn register_issuer(
        env: Env,
        issuer_id: Address,
        pubkey: BytesN<64>,
        credential_types: Vec<Symbol>,
    ) {
        Self::require_role(&env, &symbol_short!("admin"));
        let issuer = Issuer {
            pubkey,
            credential_types,
            revoked: false,
        };
        let key = DataKey::Issuer(issuer_id.clone());
        env.storage().persistent().set(&key, &issuer);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, ENTRY_TTL);

        let mut list: Vec<Address> = env
            .storage()
            .instance()
            .get(&DataKey::IssuerList)
            .unwrap_or_else(|| Vec::new(&env));
        if !list.contains(&issuer_id) {
            list.push_back(issuer_id);
            env.storage().instance().set(&DataKey::IssuerList, &list);
        }
    }

    /// Mark an issuer as revoked. Admin-role only. Existing proofs are not
    /// affected here — revocation propagates through `is_valid_issuer` checks.
    pub fn revoke_issuer(env: Env, issuer_id: Address) {
        Self::require_role(&env, &symbol_short!("admin"));
        let key = DataKey::Issuer(issuer_id);
        let mut issuer: Issuer = env
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&env, Error::IssuerNotFound));
        issuer.revoked = true;
        env.storage().persistent().set(&key, &issuer);
        env.storage()
            .persistent()
            .extend_ttl(&key, BUMP_THRESHOLD, ENTRY_TTL);
    }

    /// All registered issuer addresses (including revoked).
    pub fn get_issuers(env: Env) -> Vec<Address> {
        env.storage()
            .instance()
            .get(&DataKey::IssuerList)
            .unwrap_or_else(|| Vec::new(&env))
    }

    /// Full on-chain record for a registered issuer.
    pub fn get_issuer(env: Env, issuer_id: Address) -> Issuer {
        Self::load_issuer(&env, &issuer_id)
    }

    /// Look up an issuer's credential-signing public key (secp256k1 x || y).
    pub fn get_issuer_pubkey(env: Env, issuer_id: Address) -> BytesN<64> {
        Self::load_issuer(&env, &issuer_id).pubkey
    }

    /// True iff `issuer_id` is registered, not revoked, and trusted for
    /// `credential_type`.
    pub fn is_valid_issuer(env: Env, issuer_id: Address, credential_type: Symbol) -> bool {
        match env
            .storage()
            .persistent()
            .get::<_, Issuer>(&DataKey::Issuer(issuer_id))
        {
            Some(issuer) => !issuer.revoked && issuer.credential_types.contains(&credential_type),
            None => false,
        }
    }

    pub fn admin(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .unwrap_or_else(|| panic_with_error!(&env, Error::NotInitialized))
    }

    /// Assign `address` as the holder of `role`, replacing any previous holder.
    /// Root-admin only. Use this to delegate or rotate a role's key — e.g. hand
    /// the `admin` role to an operations key, or prepare an `issuer-manager`
    /// role for finer-grained issuer governance.
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

    fn load_issuer(env: &Env, issuer_id: &Address) -> Issuer {
        env.storage()
            .persistent()
            .get(&DataKey::Issuer(issuer_id.clone()))
            .unwrap_or_else(|| panic_with_error!(env, Error::IssuerNotFound))
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
