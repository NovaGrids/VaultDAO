# First Contribution to VaultDAO (Soroban) — from Zero to Your First Merged PR

> Target audience: new contributors (including developers new to **Soroban**) who want a hands-on path to a successful first pull request.
>
> This guide is written to be practical: it tells you what to install, how to set up the repo on a fresh machine, how to pick a good first issue, how to implement a small change, how to run the exact tests that matter, and what to expect during code review.
>
> Estimated time (typical):
>
> - Tooling + environment setup: **45–90 minutes** (first time only)
> - Pick issue + implement change: **1–3 hours**
> - Run tests + polish PR: **30–90 minutes**
> - Total: **~2.5–5 hours** (faster if your machine already has Rust/Node tooling)

---

## 0) What you’re trying to achieve (definition of “first success”)

A “successful first contribution” is not “make the biggest contract change.” It is:

1. You implement a small, well-scoped change.
2. You run the relevant tests locally and confirm they pass.
3. You open a PR with clear description + a test plan.
4. A maintainer can review your change quickly and confidently.
5. Your PR gets merged.

This guide’s worked example is a small contract API enhancement: **add a simple getter function** to the Soroban contract and back it with a unit test.

---

## 1) Prerequisites (tools you must install)

You’ll be working with three codebases:

- **Rust/Soroban contract** in `contracts/vault`
- **Frontend** in `frontend`
- **Backend** in `backend` (optional for first issue, but included for completeness)

### Tools checklist

You need:

1. **Rust** (1.70+)
   - Install via rustup:
     ```bash
     # Install rust
     rustup-init
     ```
   - Verify:
     ```bash
     rustc --version
     cargo --version
     ```

2. **wasm32 target** for Soroban builds

   ```bash
   rustup target add wasm32-unknown-unknown
   ```

3. **Stellar CLI**
   - Install (locked):
     ```bash
     cargo install --locked stellar-cli
     ```
   - Verify:
     ```bash
     stellar --version
     ```

4. **Node.js 18+**
   - Install Node.js from the official site.
   - Verify:
     ```bash
     node --version
     npm --version
     ```
   - Freighter (wallet extension) works in the browser, but the local docs walkthrough below won’t require you to actually transact on-chain.

5. **Git**
   - Verify:
     ```bash
     git --version
     ```

6. **Freighter Wallet** (browser extension)
   - Needed if your first issue touches the frontend or if you want to test UX against a real wallet.
   - Link: https://www.freighter.app/

---

## 2) Fresh environment setup (verified walkthrough for Linux/macOS/Windows)

This section is intentionally “do it exactly like this” so a first-time contributor can get to green tests.

### Common assumptions

- You’re starting from a **fresh machine** (or at least one where you haven’t cloned VaultDAO yet).
- You have a terminal ready.

### 2.1 Linux or macOS

#### Step A — clone and enter the repo

```bash
# 1) Create a folder if you want
cd ~

# 2) Clone
git clone https://github.com/NovaGrids/VaultDAO.git
cd VaultDAO
```

#### Step B — build + test the contract

```bash
cd contracts/vault

# Build wasm (release)
cargo build --target wasm32-unknown-unknown --release

# Run contract unit tests
cargo test
```

If you see warnings, they’re not necessarily a failure. What matters is that **`cargo test` ends with success**.

#### Step C — (optional) run frontend dev server

> For a true “first PR” you can often skip frontend entirely if your issue is contract-only.

```bash
cd ../../frontend
npm install
npm run dev
```

Open the printed URL (usually `http://localhost:5173`).

---

### 2.2 Windows (native)

VaultDAO can be built on Windows, but Rust toolchains sometimes work more smoothly in WSL2. Use whichever is easiest.

#### Recommended approach: WSL2 (Ubuntu)

1. Install WSL2 and Ubuntu.
2. Open a WSL terminal.
3. Follow the Linux/macOS steps inside WSL2.

This gives you one consistent “known good” environment for Soroban tests.

---

### 2.3 Windows (WSL2 workflow)

This is the most robust “verified on Windows” path.

#### Step A — install tooling in WSL2

Inside WSL:

```bash
rustup target add wasm32-unknown-unknown
# (and ensure Rust is installed)
```

#### Step B — clone repo in WSL

Prefer cloning in the Linux filesystem, not on a Windows NTFS mount:

```bash
a) mkdir -p ~/code
b) cd ~/code
c) git clone https://github.com/NovaGrids/VaultDAO.git
d) cd VaultDAO
```

#### Step C — run contract tests

```bash
cd contracts/vault
cargo build --target wasm32-unknown-unknown --release
cargo test
```

---

## 3) How to pick a good first issue

A “good first issue” usually satisfies all of these:

- Small scope (changes mostly in one area)
- Clear acceptance criteria
- Low risk of breaking unrelated contract logic
- Ideally contract-only or documentation-only

### Where to look

- GitHub Issues: https://github.com/NovaGrids/VaultDAO/issues
- GitHub Discussions (for questions): https://github.com/NovaGrids/VaultDAO/discussions

### Labels to watch

This repo uses labels like:

- `documentation`
- (often) bug/feature related labels

### What to avoid for a first PR

- Refactors that touch many modules.
- Changes that require deep understanding of vault governance.
- Issues that need major frontend state redesign.

---

## 4) Your first issue walkthrough (the “do this now” flow)

This section takes you from a blank repo clone to an opened PR.

### Step 1 — fork the repository

1. Go to the repo on GitHub.
2. Click **Fork**.
3. Use your fork as the git remote for push operations.

### Step 2 — clone your fork

```bash
git clone https://github.com/<YOUR_USERNAME>/VaultDAO.git
cd VaultDAO
```

### Step 3 — create a branch

Use a descriptive name:

```bash
git checkout -b docs/fix-typo
# or
git checkout -b contract/add-getter
# or
git checkout -b bugfix/timelock-edge-case
```

**Rule of thumb:** branch name should mention what it changes.

### Step 4 — make a small change

Pick your change target:

- `contracts/vault/src/...` for contract logic
- `contracts/vault/src/test_*.rs` or `contracts/vault/src/test.rs` for tests
- `docs/...` for documentation
- `frontend/...` for UI changes

For the worked example, we’ll change the contract.

### Step 5 — run tests (contract)

Always run at least:

```bash
cd contracts/vault
cargo test
```

If you changed Rust code and want extra confidence:

```bash
cargo fmt --all
cargo clippy --all-targets --all-features
```

**Time estimate:** 5–20 minutes on a typical dev laptop (depends on CPU and cache).

### Step 6 — run tests (frontend) only if you changed frontend

```bash
cd frontend
npm run build
npm run lint
```

### Step 7 — confirm git status and create commit(s)

```bash
git status

git add -A

git commit -m "feat(contract): add a new getter"
```

### Step 8 — push your branch

```bash
git push origin HEAD
```

### Step 9 — open the PR

- Target branch: `main`.
- Title should follow the pattern the repo uses in examples.
- In the PR description include:
  - what you changed and why
  - the test commands you ran
  - a short screenshot only if UI changes

Also, your PR will be checked against `.github/pull_request_template.md`.

---

## 5) Worked example: add a getter to the Soroban contract (end-to-end)

Goal: Add a small view function and prove it with a unit test.

This example does **not** require a live network deployment.

### 5.1 Understand what “getter” means in this repo

In Soroban contracts, “getter” usually means:

- a function marked as **public** and callable from clients
- performing **no state mutation**
- returning a value via storage reads

In this contract, a common pattern is:

- update an existing `pub fn get_*` view function
- or add a new view method in `contracts/vault/src/lib.rs`

### 5.2 Identify a minimal getter candidate

A low-risk approach for your first contract PR:

- Add a getter that returns a value already stored
- Or add an alias for an existing getter

For this walkthrough, we’ll do: “expose vault config threshold strategy name” as a new read-only helper.

> Note: the exact fields/types depend on the current contract implementation. If you choose a different getter, keep it similarly small.

### 5.3 Implement the getter (contract)

1. Open:
   - `contracts/vault/src/lib.rs`
2. Find a related “View Functions” section.
3. Add a new function, for example:
   - `pub fn get_quorum_status(...)` already exists as a read-only view
   - So a new getter should follow the same style.

Example pattern:

```rust
/// Get X from storage.
///
/// This is a read-only view function.
pub fn get_some_value(env: Env) -> Result<i128, VaultError> {
    storage::get_some_value(&env)
}
```

If it’s a plain storage wrapper, call the matching function in `contracts/vault/src/storage.rs`.

### 5.4 Write the unit test

The tests live under `contracts/vault/src/` and are compiled by the contract modules.

Common locations:

- `contracts/vault/src/test.rs`
- or dedicated modules like `test_retry.rs`, etc.

Follow the patterns from `docs/reference/TESTING.md`.

Skeleton (adapt to your getter):

```rust
#[test]
fn test_get_some_value_after_initialize() {
    let env = Env::default();
    env.mock_all_auths();

    let (client, admin, ..) = setup_vault(&env, 1);

    // Call getter
    let value = client.get_some_value().unwrap();

    // Assert expected value
    assert_eq!(value, /* expected */);
}
```

> If the getter returns a value derived from initialized config, assert against that config value.

### 5.5 Run the exact tests

From repo root or contract folder:

```bash
cd contracts/vault
cargo test
```

### 5.6 Format and lint

If the repo enforces formatting/lints in CI, apply them locally:

```bash
cargo fmt --all
cargo clippy --all-targets --all-features
```

### 5.7 Push and open PR

Follow the workflow in section 4.

### What reviewers will like about this first PR

- The change is small and has an isolated test
- The getter is clearly documented (doc comment)
- You did not break unrelated logic

---

## 6) Running specific tests (how to target the “right” failure)

When your test suite grows, you want quick feedback.

### Rust contract tests

Run a single test by name:

```bash
cd contracts/vault
cargo test test_multisig_approval
```

Run with output:

```bash
cargo test -- --nocapture
```

### Rust test modules

If the getter test is in a dedicated file/module, the test name will usually include the function name.

If you don’t know the test name, you can list tests:

```bash
cargo test -- --list
```

---

## 7) Code review expectations (what maintainers look for)

Review is easier when you optimize for clarity.

### What reviewers look for

1. **Correctness**
   - tests pass
   - logic matches contract invariants
2. **Safety / no panics**
   - avoid `unwrap()` in critical contract paths
   - prefer returning `VaultError` variants
3. **Gas / performance awareness**
   - avoid unnecessary storage reads/writes
   - don’t add large loops without bounds
4. **Readable diffs**
   - small PRs
   - descriptive comments
5. **Style compliance**
   - `cargo fmt` done
   - clippy warnings addressed when relevant

### Common rejection reasons

- PR description is unclear (“what is this change?”)
- Tests were not run locally
- Changes are too large for first PR
- Documentation missing for new public API

### How to respond to review feedback

- Make a quick follow-up commit addressing comments
- Push to the same branch
- Update the PR description with new test evidence

---

## 8) How to ask questions and propose new features

### Where to ask questions

- **General questions:** GitHub Discussions
  - https://github.com/NovaGrids/VaultDAO/discussions
- **Bugs / specific issues:** GitHub Issues
  - https://github.com/NovaGrids/VaultDAO/issues

### How to propose a new feature

In an issue or discussion:

1. Explain the problem you’re solving
2. Propose the smallest viable change
3. Call out risks and tradeoffs (especially for contract changes)
4. If you have a draft PR, mention how it would be tested

---

## 9) Quick “first PR” checklist (copy into your brain)

Before opening a PR:

- [ ] I picked a small issue with clear acceptance criteria
- [ ] I ran `cd contracts/vault && cargo test`
- [ ] I ran `cargo fmt --all` (and optionally clippy)
- [ ] My PR includes a clear explanation + test plan
- [ ] I didn’t introduce secrets

---

## Appendix A — Handy command reference

### Contract

```bash
cd contracts/vault
cargo build --target wasm32-unknown-unknown --release
cargo test
cargo fmt --all
cargo clippy --all-targets --all-features
```

### Frontend

```bash
cd frontend
npm install
npm run dev
npm run build
npm run lint
```

---

## Appendix B — What to do if something fails

### 1) `cargo test` fails

- Re-run with output:
  ```bash
  cargo test -- --nocapture
  ```
- Fix the failing test first.
- If it’s a type error, ensure your getter signature matches the SDK usage and contract client generation patterns.

### 2) Formatting/lint failures

- Run:
  ```bash
  cargo fmt --all
  ```
- Then re-run `cargo test`.

### 3) You’re blocked on Soroban specifics

Ask in Discussions with:

- the failing command
- the exact error output
- what you expected to happen

---

## Appendix C — Why “worked example” matters

Your first PR should demonstrate:

- you can safely change contract code
- you can write tests in Soroban simulation
- you can iterate with maintainer feedback

Once you deliver that, the project becomes much easier to contribute to.
