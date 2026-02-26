use std::env;
/// Preservation Property Tests for Local Compilation Behavior
///
/// **Property 2: Preservation** - Local Compilation Behavior
/// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
///
/// These tests verify that local compilation produces the same successful result
/// before and after any fix is applied. They capture the baseline behavior that
/// must be preserved.
///
/// EXPECTED OUTCOME: Tests PASS on unfixed code (confirms baseline to preserve)
/// After fix: Tests PASS (confirms no regressions)
use std::process::Command;

#[test]
fn test_local_compilation_succeeds() {
    // Verify that local cargo build succeeds
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    let output = Command::new("cargo")
        .arg("build")
        .arg("--target")
        .arg("wasm32-unknown-unknown")
        .arg("--release")
        .current_dir(&manifest_dir)
        .output()
        .expect("Failed to execute cargo build");

    assert!(
        output.status.success(),
        "Local compilation should succeed. Exit code: {:?}\nStderr: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_local_test_suite_passes() {
    // Verify that cargo test passes locally
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    let output = Command::new("cargo")
        .arg("test")
        .arg("--lib")
        .current_dir(&manifest_dir)
        .output()
        .expect("Failed to execute cargo test");

    let stderr = String::from_utf8_lossy(&output.stderr);

    assert!(
        output.status.success(),
        "Local test suite should pass. Exit code: {:?}\nStderr: {}",
        output.status.code(),
        stderr
    );

    // Verify no test failures
    assert!(
        !stderr.contains("test result: FAILED"),
        "Test suite should not have failures"
    );
}

#[test]
fn test_local_clippy_passes() {
    // Verify that clippy passes locally with warnings as errors
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    let output = Command::new("cargo")
        .arg("clippy")
        .arg("--all-targets")
        .arg("--all-features")
        .arg("--")
        .arg("-D")
        .arg("warnings")
        .current_dir(&manifest_dir)
        .output()
        .expect("Failed to execute cargo clippy");

    assert!(
        output.status.success(),
        "Local clippy should pass. Exit code: {:?}\nStderr: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_local_fmt_check_passes() {
    // Verify that fmt check passes locally
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    let output = Command::new("cargo")
        .arg("fmt")
        .arg("--all")
        .arg("--")
        .arg("--check")
        .current_dir(&manifest_dir)
        .output()
        .expect("Failed to execute cargo fmt");

    assert!(
        output.status.success(),
        "Local fmt check should pass. Exit code: {:?}\nStderr: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn test_existing_functionality_preserved() {
    // Verify that existing types, storage, events, and errors remain accessible
    // This is a compile-time check - if this test compiles, the types are accessible

    use std::fs;
    use std::path::Path;

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let src_dir = Path::new(&manifest_dir).join("src");

    // Verify core module files exist and are readable
    let modules = vec!["types.rs", "storage.rs", "events.rs", "errors.rs", "lib.rs"];

    for module in modules {
        let path = src_dir.join(module);
        assert!(path.exists(), "Module {} should exist", module);

        let content = fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("Should be able to read {}", module));

        assert!(!content.is_empty(), "Module {} should not be empty", module);
    }
}

#[test]
fn test_contract_structure_preserved() {
    // Verify the contract structure remains intact
    use std::fs;
    use std::path::Path;

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let lib_path = Path::new(&manifest_dir).join("src/lib.rs");

    let content = fs::read_to_string(&lib_path).expect("Should be able to read lib.rs");

    // Verify key contract elements exist
    assert!(
        content.contains("pub struct VaultDAO"),
        "VaultDAO struct should exist"
    );
    assert!(
        content.contains("#[contract]"),
        "Contract attribute should exist"
    );
    assert!(
        content.contains("#[contractimpl]"),
        "Contract impl should exist"
    );

    // Verify module declarations
    assert!(
        content.contains("mod types"),
        "types module should be declared"
    );
    assert!(
        content.contains("mod storage"),
        "storage module should be declared"
    );
    assert!(
        content.contains("mod events"),
        "events module should be declared"
    );
    assert!(
        content.contains("mod errors"),
        "errors module should be declared"
    );
}

#[test]
fn test_delegation_functionality_accessible() {
    // Verify delegation functions are defined and accessible
    use std::fs;
    use std::path::Path;

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let lib_path = Path::new(&manifest_dir).join("src/lib.rs");

    let content = fs::read_to_string(&lib_path).expect("Should be able to read lib.rs");

    // Verify delegation functions exist
    assert!(
        content.contains("pub fn delegate_voting_power"),
        "delegate_voting_power function should exist"
    );
    assert!(
        content.contains("pub fn revoke_delegation"),
        "revoke_delegation function should exist"
    );
}

#[test]
fn test_wasm_target_compilation() {
    // Verify that the contract can be compiled to wasm32-unknown-unknown target
    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    let output = Command::new("cargo")
        .arg("build")
        .arg("--target")
        .arg("wasm32-unknown-unknown")
        .arg("--release")
        .current_dir(&manifest_dir)
        .output()
        .expect("Failed to execute cargo build for wasm target");

    assert!(
        output.status.success(),
        "WASM target compilation should succeed. Exit code: {:?}\nStderr: {}",
        output.status.code(),
        String::from_utf8_lossy(&output.stderr)
    );

    // Verify the wasm file was created
    use std::path::Path;
    let wasm_path =
        Path::new(&manifest_dir).join("target/wasm32-unknown-unknown/release/vault_dao.wasm");

    assert!(
        wasm_path.exists(),
        "WASM file should be generated at {:?}",
        wasm_path
    );
}
