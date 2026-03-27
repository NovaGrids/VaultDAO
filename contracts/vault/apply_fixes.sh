#!/usr/bin/env bash
# apply_fixes.sh — fixes all compile errors in src/test.rs
#
# Usage:
#   bash apply_fixes.sh                   # defaults to src/test.rs
#   bash apply_fixes.sh path/to/test.rs   # explicit path
#
# What it fixes:
#   1. Duplicate `quorum` and `velocity_limit` fields injected inline after
#      `threshold: N,` in every InitConfig and RecoveryConfig struct literal.
#   2. Missing `memo` field in the TemplateOverrides literal inside
#      test_create_from_template_with_overrides.
#   3. Dangling `pre_execution_hooks` / `post_execution_hooks` fields that
#      appear outside the closing brace of certain struct literals
#      (default_init_config and inv_config helpers).
#   4. Dangling `assert_eq!` after the removed retry_execution function call
#      in test_retry_disabled_rejects_retry_execution.

FILE="${1:-src/test.rs}"

if [[ ! -f "$FILE" ]]; then
  echo "ERROR: file not found: $FILE" >&2
  exit 1
fi

python3 - "$FILE" << 'PYEOF'
import sys, re

with open(sys.argv[1], 'r') as f:
    text = f.read()

original = text

# ---------------------------------------------------------------------------
# Fix 1a: Remove DOUBLE spurious injection after `threshold: N,`
# Before: threshold: N, quorum: 0, velocity_limit: ...{...}, quorum: 0, velocity_limit: ...{...},
# After:  threshold: N,
# ---------------------------------------------------------------------------
double_pat = re.compile(
    r'(threshold:\s*\d+),\s*'
    r'quorum:\s*0,\s*velocity_limit:\s*crate::types::VelocityConfig\s*\{[^}]+\},\s*'
    r'quorum:\s*0,\s*velocity_limit:\s*crate::types::VelocityConfig\s*\{[^}]+\},'
)
text, n = double_pat.subn(r'\1,', text)
print(f"  Fix 1a (double injection): {n} replacements")

# ---------------------------------------------------------------------------
# Fix 1b: Remove SINGLE spurious injection after `threshold: N,`
# Before: threshold: N, quorum: 0, velocity_limit: ...{...},
# After:  threshold: N,
# ---------------------------------------------------------------------------
single_pat = re.compile(
    r'(threshold:\s*\d+),\s*'
    r'quorum:\s*0,\s*velocity_limit:\s*crate::types::VelocityConfig\s*\{[^}]+\},'
)
text, n = single_pat.subn(r'\1,', text)
print(f"  Fix 1b (single injection): {n} replacements")

# ---------------------------------------------------------------------------
# Fix 2: Add missing `memo` field in TemplateOverrides
# Inserts:  memo: Symbol::new(&env, "bonus"),
# between `override_memo: true,` and `override_priority:` lines
# ---------------------------------------------------------------------------
missing_memo = re.compile(
    r'(override_memo:\s*true,\n(\s*))\n(\s*override_priority:)'
)
def add_memo(m):
    indent = re.match(r'(\s*)', m.group(3)).group(1)
    return m.group(1) + indent + 'memo: Symbol::new(&env, "bonus"),\n' + m.group(3)
text, n = missing_memo.subn(add_memo, text)
print(f"  Fix 2 (missing memo):      {n} replacements")

# ---------------------------------------------------------------------------
# Fix 3: Dangling pre/post_execution_hooks outside struct closing brace
#
# Broken layout:
#     staking_config: types::StakingConfig::default(),
#   }          <-- extra closing brace
# ,            <-- stray comma
#     pre_execution_hooks: soroban_sdk::Vec::new(&env),
#     post_execution_hooks: soroban_sdk::Vec::new(&env),
#   }          <-- real closing brace
#
# Fixed layout:
#     staking_config: types::StakingConfig::default(),
#     pre_execution_hooks: soroban_sdk::Vec::new(&env),
#     post_execution_hooks: soroban_sdk::Vec::new(&env),
#   }
# ---------------------------------------------------------------------------
dangling = re.compile(
    r'([ \t]+staking_config:\s*types::StakingConfig::default\(\),\n)'
    r'[ \t]*\}\n'          # extra closing brace
    r'[,\s]*\n'            # stray comma / blank line
    r'([ \t]+pre_execution_hooks:[^\n]+\n)'
    r'([ \t]+post_execution_hooks:[^\n]+\n)'
    r'([ \t]*\})'
)
text, n = dangling.subn(r'\1\2\3\4', text)
print(f"  Fix 3 (dangling hooks):    {n} replacements")

# ---------------------------------------------------------------------------
# Fix 4: Comment out dangling `assert_eq!` after removed retry function
# ---------------------------------------------------------------------------
before = ('    // let result = // // client.try_retry_execution removed;\n'
          '    assert_eq!(result.err(), Some(Ok(VaultError::RetryError)));')
after  = ('    // Retry execution function removed — test is a placeholder\n'
          '    // assert_eq!(result.err(), Some(Ok(VaultError::RetryError)));')
if before in text:
    text = text.replace(before, after)
    print(f"  Fix 4 (dangling assert):   1 replacement")
else:
    print(f"  Fix 4 (dangling assert):   0 replacements (pattern not found — may already be fixed)")

# ---------------------------------------------------------------------------
# Write result
# ---------------------------------------------------------------------------
if text == original:
    print("\nWARNING: no changes were made — check that FILE path is correct")
else:
    with open(sys.argv[1], 'w') as f:
        f.write(text)
    print(f"\nDone. Written: {sys.argv[1]}")
PYEOF