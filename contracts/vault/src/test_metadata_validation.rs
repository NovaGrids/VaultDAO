use super::*;
use soroban_sdk::{Env, testutils::Address as _, Symbol, String};

#[test]
fn test_validate_metadata_key_valid_short() {
    let env = Env::default();
    let key = Symbol::new(&env, "valid");
    assert!(validate_metadata_key(&key).is_ok());
}

#[test]
fn test_validate_metadata_key_valid_max_len() {
    let env = Env::default();
    let max_key = "a".repeat(MAX_METADATA_KEY_LEN as usize);
    let key = Symbol::new(&env, &max_key);
    assert!(validate_metadata_key(&key).is_ok());
}

#[test]
fn test_validate_metadata_key_empty_invalid() {
    let env = Env::default();
    let key = Symbol::new(&env, "");
    let result = validate_metadata_key(&key);
    assert_eq!(result, Err(VaultError::MetadataKeyInvalid));
}

#[test]
fn test_validate_metadata_key_too_long_invalid() {
    let env = Env::default();
    let long_key = "a".repeat((MAX_METADATA_KEY_LEN + 1) as usize);
    let key = Symbol::new(&env, &long_key);
    let result = validate_metadata_key(&key);
    assert_eq!(result, Err(VaultError::MetadataKeyInvalid));
}

#[test]
fn test_validate_metadata_key_invalid_chars() {
    let env = Env::default();
    let invalid_keys = ["@invalid", "space key", "hyphen-key"];
    for key_str in invalid_keys {
        let key = Symbol::new(&env, key_str);
        let result = validate_metadata_key(&key);
        assert_eq!(result, Err(VaultError::MetadataKeyInvalid));
    }
}

#[test]
fn test_validate_metadata_key_valid_underscore() {
    let env = Env::default();
    let key = Symbol::new(&env, "valid_key");
    assert!(validate_metadata_key(&key).is_ok());
}

#[test]
#[should_panic]
fn test_validate_metadata_value_empty_panics() {
    let env = Env::default();
    let value = String::from_str(&env, "");
    validate_metadata_value(&value).unwrap();
}

#[test]
fn test_validate_metadata_value_valid() {
    let env = Env::default();
    let value = String::from_str(&env, "valid value");
    assert!(validate_metadata_value(&value).is_ok());
}

#[test]
fn test_validate_metadata_value_max_len_valid() {
    let env = Env::default();
    let max_value = "a".repeat(MAX_METADATA_VALUE_LEN as usize);
    let value = String::from_str(&env, &max_value);
    assert!(validate_metadata_value(&value).is_ok());
}

#[test]
fn test_validate_metadata_value_too_long_invalid() {
    let env = Env::default();
    let long_value = "a".repeat((MAX_METADATA_VALUE_LEN + 1) as usize);
    let value = String::from_str(&env, &long_value);
    let result = validate_metadata_value(&value);
    assert_eq!(result, Err(VaultError::MetadataValueInvalid));
}
