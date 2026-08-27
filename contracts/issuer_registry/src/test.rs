#![cfg(test)]

use super::*;
use soroban_sdk::{
    symbol_short,
    testutils::{Address as _, MockAuth, MockAuthInvoke},
    vec, Address, BytesN, Env, IntoVal, Symbol,
};

fn setup(env: &Env) -> (Address, IssuerRegistryClient<'_>) {
    let admin = Address::generate(env);
    let contract_id = env.register(IssuerRegistry, (admin.clone(),));
    (admin, IssuerRegistryClient::new(env, &contract_id))
}

#[test]
fn register_and_query() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[7u8; 64]);
    let types = vec![&env, symbol_short!("kyc"), symbol_short!("age")];

    client.register_issuer(&issuer, &pubkey, &types);

    assert_eq!(client.get_issuer_pubkey(&issuer), pubkey);
    assert!(client.is_valid_issuer(&issuer, &symbol_short!("kyc")));
    assert!(client.is_valid_issuer(&issuer, &symbol_short!("age")));
    assert!(!client.is_valid_issuer(&issuer, &symbol_short!("income")));
}

#[test]
fn get_issuers_lists_registered() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer_a = Address::generate(&env);
    let issuer_b = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[7u8; 64]);
    let types = vec![&env, symbol_short!("kyc")];

    client.register_issuer(&issuer_a, &pubkey, &types);
    client.register_issuer(&issuer_b, &pubkey, &types);

    let listed = client.get_issuers();
    assert_eq!(listed.len(), 2);
    assert!(listed.contains(&issuer_a));
    assert!(listed.contains(&issuer_b));
    assert_eq!(client.get_issuer(&issuer_a).pubkey, pubkey);
}

#[test]
fn revoked_issuer_is_invalid() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[1u8; 64]);
    client.register_issuer(&issuer, &pubkey, &vec![&env, symbol_short!("kyc")]);
    assert!(client.is_valid_issuer(&issuer, &symbol_short!("kyc")));

    client.revoke_issuer(&issuer);
    assert!(!client.is_valid_issuer(&issuer, &symbol_short!("kyc")));
}

#[test]
fn unknown_issuer_is_invalid() {
    let env = Env::default();
    let (_admin, client) = setup(&env);
    let stranger = Address::generate(&env);
    assert!(!client.is_valid_issuer(&stranger, &symbol_short!("kyc")));
}

// ── RBAC tests ────────────────────────────────────────────────────────────────

#[test]
fn constructor_seeds_admin_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup(&env);

    assert!(client.has_role(&symbol_short!("admin"), &admin));
    let stranger = Address::generate(&env);
    assert!(!client.has_role(&symbol_short!("admin"), &stranger));
}

#[test]
fn admin_can_grant_and_revoke_roles() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let delegate = Address::generate(&env);
    let other = Address::generate(&env);

    client.grant_role(&symbol_short!("admin"), &delegate);
    assert!(client.has_role(&symbol_short!("admin"), &delegate));

    // Re-granting moves the role to the new holder.
    client.grant_role(&symbol_short!("admin"), &other);
    assert!(!client.has_role(&symbol_short!("admin"), &delegate));
    assert!(client.has_role(&symbol_short!("admin"), &other));

    // Revoking an address that is not the current holder is rejected.
    let res = client.try_revoke_role(&symbol_short!("admin"), &delegate);
    assert!(res.is_err());

    client.revoke_role(&symbol_short!("admin"), &other);
    assert!(!client.has_role(&symbol_short!("admin"), &other));

    // Revoking an unassigned role is a harmless no-op.
    let res = client.try_revoke_role(&symbol_short!("admin"), &other);
    assert!(res.is_ok());
}

#[test]
fn grant_revoke_require_root_admin() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let delegate = Address::generate(&env);

    // No auths mocked → the root admin's required auth fails.
    let res = client
        .mock_auths(&[])
        .try_grant_role(&symbol_short!("admin"), &delegate);
    assert!(res.is_err());
    let res = client
        .mock_auths(&[])
        .try_revoke_role(&symbol_short!("admin"), &delegate);
    assert!(res.is_err());
}

#[test]
fn register_issuer_requires_admin_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup(&env);
    let contract_id = client.address.clone();
    let delegate = Address::generate(&env);
    let stranger = Address::generate(&env);

    client.grant_role(&symbol_short!("admin"), &delegate);

    let pubkey = BytesN::from_array(&env, &[7u8; 64]);
    let issuer = Address::generate(&env);
    let types = vec![&env, symbol_short!("kyc")];
    let args = (issuer.clone(), pubkey.clone(), types.clone());

    // The admin-role holder can register an issuer…
    client
        .mock_auths(&[MockAuth {
            address: &delegate,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "register_issuer",
                args: args.clone().into_val(&env),
                sub_invokes: &[],
            },
        }])
        .register_issuer(&issuer, &pubkey, &types);
    assert!(client.is_valid_issuer(&issuer, &symbol_short!("kyc")));

    // …a non-holder cannot.
    let res = client
        .mock_auths(&[MockAuth {
            address: &stranger,
            invoke: &MockAuthInvoke {
                contract: &contract_id,
                fn_name: "register_issuer",
                args: args.into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_register_issuer(&issuer, &pubkey, &types);
    assert!(res.is_err());

    // The root admin (Admin key holder) can re-grant the role to themselves.
    client.grant_role(&symbol_short!("admin"), &admin);
    assert!(client.has_role(&symbol_short!("admin"), &admin));
}

#[test]
fn revoke_issuer_requires_admin_role() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);
    let delegate = Address::generate(&env);

    // Delegate the admin role and register an issuer as the delegate.
    client.grant_role(&symbol_short!("admin"), &delegate);
    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[7u8; 64]);
    let types = vec![&env, symbol_short!("kyc")];
    client.register_issuer(&issuer, &pubkey, &types);
    assert!(client.is_valid_issuer(&issuer, &symbol_short!("kyc")));

    // Revoke the delegated role; the former holder can no longer revoke issuers.
    client.revoke_role(&symbol_short!("admin"), &delegate);
    let res = client
        .mock_auths(&[MockAuth {
            address: &delegate,
            invoke: &MockAuthInvoke {
                contract: &client.address,
                fn_name: "revoke_issuer",
                args: (&issuer,).into_val(&env),
                sub_invokes: &[],
            },
        }])
        .try_revoke_issuer(&issuer);
    assert!(res.is_err());
    assert!(client.is_valid_issuer(&issuer, &symbol_short!("kyc")));
}

#[test]
fn has_role_is_a_public_view() {
    let env = Env::default();
    env.mock_all_auths();
    let (admin, client) = setup(&env);
    let delegate = Address::generate(&env);

    // Readable with zero mocked auths — no authorization required.
    assert!(client
        .mock_auths(&[])
        .has_role(&symbol_short!("admin"), &admin));
    assert!(!client
        .mock_auths(&[])
        .has_role(&symbol_short!("admin"), &delegate));

    client.grant_role(&Symbol::new(&env, "issuer_manager"), &delegate);
    assert!(client.has_role(&Symbol::new(&env, "issuer_manager"), &delegate));
}

#[test]
fn register_issuer_by_unmocked_admin_fails() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[1u8; 64]);
    let res = client.mock_auths(&[]).try_register_issuer(
        &issuer,
        &pubkey,
        &vec![&env, symbol_short!("kyc")],
    );
    assert!(res.is_err());
    assert!(!client.is_valid_issuer(&issuer, &symbol_short!("kyc")));
}
