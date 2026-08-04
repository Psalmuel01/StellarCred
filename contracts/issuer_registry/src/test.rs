#![cfg(test)]

use super::*;
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

#[test]
fn register_issuer_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[7u8; 64]);

    client.register_issuer(&issuer, &pubkey, &vec![&env, symbol_short!("kyc")]);

    // Assert immediately after the call — the snapshot framework drains
    // env.events().all() after each contract invocation, so we must
    // capture events before any subsequent call.
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("iss_reg"), symbol_short!("register")).into_val(&env),
                EventIssuerRegistered {
                    issuer: issuer.clone(),
                    pubkey: pubkey.clone(),
                }
                .into_val(&env),
            ),
        ],
    );
}

#[test]
fn revoke_issuer_emits_event() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, client) = setup(&env);

    let issuer = Address::generate(&env);
    let pubkey = BytesN::from_array(&env, &[1u8; 64]);

    // Call register and assert its event immediately.
    client.register_issuer(&issuer, &pubkey, &vec![&env, symbol_short!("kyc")]);
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("iss_reg"), symbol_short!("register")).into_val(&env),
                EventIssuerRegistered {
                    issuer: issuer.clone(),
                    pubkey: pubkey.clone(),
                }
                .into_val(&env),
            ),
        ],
    );

    // Call revoke and assert its event immediately.
    client.revoke_issuer(&issuer);
    assert_eq!(
        env.events().all(),
        vec![
            &env,
            (
                client.address.clone(),
                (symbol_short!("iss_reg"), symbol_short!("revoked")).into_val(&env),
                EventIssuerRevoked { issuer: issuer.clone() }.into_val(&env),
            ),
        ],
    );
}
