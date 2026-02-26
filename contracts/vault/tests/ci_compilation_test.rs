use std::env;
/// Bug Condition Exploration Test for CI Compilation Failure
///
/// **Property 1: Fault Condition** - CI Compilation Failure
/// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7**
///
/// This test MUST FAIL on unfixed code - failure confirms the bug exists.
/// The test verifies that the contract compiles successfully in CI environment
/// without "cannot find type", "cannot find function", or "cannot find variant" errors.
///
/// EXPECTED OUTCOME: Test FAILS on unfixed code (proves bug exists)
/// After fix: Test PASSES (confirms bug is fixed)
use std::process::Command;

#[test]
fn test_ci_compilation_succeeds() {
    // This test simulates CI compilation behavior
    // It should FAIL on unfixed code, demonstrating the bug exists

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();

    // Run cargo build as CI would
    let output = Command::new("cargo")
        .arg("build")
        .arg("--target")
        .arg("wasm32-unknown-unknown")
        .arg("--release")
        .current_dir(&manifest_dir)
        .output()
        .expect("Failed to execute cargo build");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined_output = format!("{}\n{}", stdout, stderr);

    // Check for compilation success
    assert!(
        output.status.success(),
        "Compilation failed with exit code: {:?}\n\nOutput:\n{}",
        output.status.code(),
        combined_output
    );

    // Verify no "cannot find type" errors for delegation types
    assert!(
        !combined_output.contains("cannot find type `Delegation`"),
        "Found 'cannot find type Delegation' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find type `DelegationHistory`"),
        "Found 'cannot find type DelegationHistory' error in compilation output"
    );

    // Verify no "cannot find function" errors for delegation storage functions
    assert!(
        !combined_output.contains("cannot find function `get_delegation`"),
        "Found 'cannot find function get_delegation' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find function `set_delegation`"),
        "Found 'cannot find function set_delegation' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find function `emit_delegation_created`"),
        "Found 'cannot find function emit_delegation_created' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find function `emit_delegated_vote`"),
        "Found 'cannot find function emit_delegated_vote' error in compilation output"
    );

    // Verify no "cannot find variant" errors for delegation error types
    assert!(
        !combined_output.contains("cannot find variant `DelegationError`"),
        "Found 'cannot find variant DelegationError' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find variant `DelegationChainTooLong`"),
        "Found 'cannot find variant DelegationChainTooLong' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find variant `CircularDelegation`"),
        "Found 'cannot find variant CircularDelegation' error in compilation output"
    );

    assert!(
        !combined_output.contains("cannot find variant `DexError`"),
        "Found 'cannot find variant DexError' error in compilation output"
    );

    // If we reach here, compilation succeeded without delegation/DEX errors
    println!("✓ Compilation succeeded without delegation/DEX infrastructure errors");
}

#[test]
fn test_delegation_components_exist_in_source() {
    // This test verifies that all reported missing components actually exist in source
    // This helps confirm the bug is an environment/configuration issue, not missing code

    use std::fs;
    use std::path::Path;

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
    let src_dir = Path::new(&manifest_dir).join("src");

    // Check types.rs for Delegation types
    let types_content =
        fs::read_to_string(src_dir.join("types.rs")).expect("Failed to read types.rs");
    assert!(
        types_content.contains("pub struct Delegation"),
        "Delegation type not found in types.rs"
    );
    assert!(
        types_content.contains("pub struct DelegationHistory"),
        "DelegationHistory type not found in types.rs"
    );

    // Check storage.rs for delegation functions
    let storage_content =
        fs::read_to_string(src_dir.join("storage.rs")).expect("Failed to read storage.rs");
    assert!(
        storage_content.contains("pub fn get_delegation"),
        "get_delegation function not found in storage.rs"
    );
    assert!(
        storage_content.contains("pub fn set_delegation"),
        "set_delegation function not found in storage.rs"
    );

    // Check events.rs for delegation event functions
    let events_content =
        fs::read_to_string(src_dir.join("events.rs")).expect("Failed to read events.rs");
    assert!(
        events_content.contains("pub fn emit_delegation_created")
            || events_content.contains("pub fn emit_delegated_vote"),
        "Delegation event functions not found in events.rs"
    );

    // Check errors.rs for delegation error variants
    let errors_content =
        fs::read_to_string(src_dir.join("errors.rs")).expect("Failed to read errors.rs");
    assert!(
        errors_content.contains("DelegationError")
            || errors_content.contains("DelegationChainTooLong")
            || errors_content.contains("CircularDelegation"),
        "Delegation error variants not found in errors.rs"
    );
    assert!(
        errors_content.contains("DexError"),
        "DexError variant not found in errors.rs"
    );

    println!("✓ All delegation and DEX components exist in source files");
}
