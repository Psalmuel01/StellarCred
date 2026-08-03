#![cfg(test)]

use super::*;
use proptest::prelude::*;
use soroban_sdk::{symbol_short, testutils::{Address as _, Events as _}, vec, Address, BytesN, Env, IntoVal};

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

// ── Property-based tests ──────────────────────────────────

/// Property: A revoked issuer is never valid for any credential type.
/// Once `revoke_issuer` is called, `is_valid_issuer` must return false
/// for all credential types, regardless of what the issuer was trusted for.
#[test]
fn prop_revoked_issuer_never_valid() {
    let config = proptest::test_runner::Config {
        cases: 10,
        ..proptest::test_runner::Config::default()
    };
    let mut runner = proptest::test_runner::TestRunner::new(config);
    runner.run(
        &(0u64..u64::MAX, 0u64..u64::MAX),
        |(_seed_a, _seed_b)| {
            let env = Env::default();
            env.mock_all_auths();
            let (_admin, client) = setup(&env);

            let issuer = Address::generate(&env);
            let pubkey = BytesN::from_array(&env, &[1u8; 64]);
            client.register_issuer(
                &issuer,
                &pubkey,
                &vec![&env, symbol_short!("kyc"), symbol_short!("age")],
            );

            // Issuer is valid before revocation.
            assert!(client.is_valid_issuer(&issuer, &symbol_short!("kyc")));
            assert!(client.is_valid_issuer(&issuer, &symbol_short!("age")));

            // Revoke the issuer.
            client.revoke_issuer(&issuer);

            // After revocation, issuer must be invalid for all types.
            let kyc_valid = client.is_valid_issuer(&issuer, &symbol_short!("kyc"));
            let age_valid = client.is_valid_issuer(&issuer, &symbol_short!("age"));

            prop_assert!(!kyc_valid, "Revoked issuer should not be valid for kyc");
            prop_assert!(!age_valid, "Revoked issuer should not be valid for age");
            Ok(())
        },
    )
    .unwrap();
}

/// Property: An unregistered issuer is never valid.
/// For any randomly generated address that has not been registered in the
/// IssuerRegistry, `is_valid_issuer` must return false for all credential types.
#[test]
fn prop_unregistered_issuer_never_valid() {
    let config = proptest::test_runner::Config {
        cases: 10,
        ..proptest::test_runner::Config::default()
    };
    let mut runner = proptest::test_runner::TestRunner::new(config);
    runner.run(&(0u64..u64::MAX), |_seed| {
        let env = Env::default();
        env.mock_all_auths();
        let (_admin, client) = setup(&env);

        // Address::generate creates a unique address not registered
        // in the IssuerRegistry.
        let unregistered = Address::generate(&env);

        prop_assert!(
            !client.is_valid_issuer(&unregistered, &symbol_short!("kyc")),
            "Unregistered issuer should never be valid"
        );
        prop_assert!(
            !client.is_valid_issuer(&unregistered, &symbol_short!("age")),
            "Unregistered issuer should never be valid for any type"
        );
        Ok(())
    })
    .unwrap();
}

#[test]
fn set_and_get_issuer_metadata() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[7u8; 64]);
    let types = vec![&env, symbol_short!("kyc")];
    client.register_issuer(&issuer, &pubkey, &types);

    // No metadata set yet.
    let meta = client.get_issuer_metadata(&issuer);
    assert!(meta.is_none());

    // Set name + url, leave logo as None.
    client.set_issuer_metadata(
        &issuer,
        &Some(String::from_str(&env, "Test Issuer")),
        &Some(String::from_str(&env, "https://example.com")),
        &None,
    );

    let meta = client.get_issuer_metadata(&issuer).unwrap();
    assert_eq!(meta.name, Some(String::from_str(&env, "Test Issuer")));
    assert_eq!(meta.url, Some(String::from_str(&env, "https://example.com")));
    assert!(meta.logo.is_none());

    // Update to add logo and change name.
    client.set_issuer_metadata(
        &issuer,
        &Some(String::from_str(&env, "Updated Issuer")),
        &None,
        &Some(String::from_str(&env, "https://example.com/logo.png")),
    );

    let meta = client.get_issuer_metadata(&issuer).unwrap();
    assert_eq!(meta.name, Some(String::from_str(&env, "Updated Issuer")));
    assert!(meta.url.is_none());
    assert_eq!(
        meta.logo,
        Some(String::from_str(&env, "https://example.com/logo.png"))
    );
}

#[test]
fn get_issuer_metadata_returns_none_for_unknown() {
    let env = Env::default();
    let (_admin, client) = setup(&env);
    let stranger = Address::generate(&env);
    let meta = client.get_issuer_metadata(&stranger);
    assert!(meta.is_none());
}

#[test]
#[should_panic]
fn set_issuer_metadata_requires_admin() {
    let env = Env::default();
    // Do NOT call mock_all_auths() – require_admin() will reject the call.
    let (_admin, client) = setup(&env);
    let issuer = Address::generate(&env);
    client.set_issuer_metadata(&issuer, &Some(String::from_str(&env, "x")), &None, &None);
}
