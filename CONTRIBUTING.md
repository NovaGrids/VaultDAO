# Contributing to VaultDAO

Thank you for your interest in contributing to VaultDAO! We're building the "Gnosis Safe of Stellar" and welcome contributions from developers of all skill levels.

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have the following installed:

> For a step-by-step, hands-on first-issue walkthrough (including verified environment setup for Linux/macOS/Windows (WSL2), a worked Soroban contract example, and PR/code-review expectations), see:
>
> - [docs/guides/FIRST_CONTRIBUTION.md](docs/guides/FIRST_CONTRIBUTION.md)

- **Rust** (1.70 or later): [Install Rust](https://rustup.rs/)
- **wasm32 target**: `rustup target add wasm32-unknown-unknown`
- **Stellar CLI** (latest): [Installation Guide](https://developers.stellar.org/docs/tools/developer-tools)
- **Node.js** (18.x or later): [Install Node.js](https://nodejs.org/)
- **Git**: [Install Git](https://git-scm.com/)

### Development Environment Setup

1. **Fork and Clone**

   ```bash
   git clone https://github.com/YOUR_USERNAME/VaultDAO.git
   cd VaultDAO
   ```

2. **Smart Contract Setup**

   ```bash
   cd contracts/vault

   # Install dependencies and build
   cargo build --target wasm32-unknown-unknown --release

   # Run tests to verify setup
   cargo test
   ```

   All tests should pass. If you see warnings about deprecated methods, that's expected.

3. **Frontend Setup**

   ```bash
   cd frontend

   # Install dependencies
   npm install

   # Start development server
   npm run dev
   ```

   The app should be running at `http://localhost:5173`

## 📝 Code Style Guidelines

### Rust (Smart Contract)

- **Formatting**: Use `cargo fmt` before committing

  ```bash
  cargo fmt --all
  ```

- **Linting**: Run `cargo clippy` and address warnings

  ```bash
  cargo clippy --all-targets --all-features
  ```

- **Documentation**: Add doc comments for public functions

  ```rust
  /// Proposes a new transfer from the vault.
  ///
  /// # Arguments
  /// * `proposer` - The address initiating the proposal
  /// * `recipient` - The destination address
  /// * `amount` - Transfer amount in stroops
  pub fn propose_transfer(/* ... */) { }
  ```

- **Error Handling**: Use the defined `VaultError` enum, don't panic
- **Testing**: Add tests for new functionality in `src/test.rs`

### TypeScript/React (Frontend)

- **Formatting**: Code is auto-formatted with ESLint

  ```bash
  npm run lint
  ```

- **Component Structure**: Keep components under 150 lines
- **Naming**: Use PascalCase for components, camelCase for functions
- **Hooks**: Follow React hooks rules (use ESLint warnings as guidance)
- **Types**: Always use TypeScript types, avoid `any`

#### Avoiding Stale Closures in Real-Time Subscriptions

A **stale closure** happens when a callback (e.g. a WebSocket handler) captures
a variable at the time it is created and never sees later updates.  This is a
common bug in components that subscribe to live data.

**The problem:**

```tsx
// ❌ BAD — the callback closes over `proposal` from the first render.
//    When a WS update arrives, it merges into the *original* object,
//    not the latest state.
useEffect(() => {
  const unsub = subscribe('proposal_updated', (update) => {
    render({ ...proposal, ...update }); // `proposal` is always stale
  });
  return unsub;
}, []); // empty deps → callback never re-created
```

**The fix — separate state + functional updater:**

```tsx
// ✅ GOOD — live data lives in its own state bucket.
//    The functional updater receives `prev` (always the latest value),
//    so the callback never needs to close over any external variable.
const [liveProposal, setLiveProposal] = useState(initialProposal);

const handleUpdate = useCallback((data) => {
  setLiveProposal((prev) => ({ ...prev, ...data })); // `prev` is always fresh
}, [/* no deps that could go stale */]);

useEffect(() => {
  const unsub = subscribe('proposal_updated', handleUpdate);
  return unsub; // always clean up on unmount
}, [subscribe, handleUpdate]);
```

**Rules of thumb for subscription callbacks:**

1. **Never read state or props inside a subscription callback** — pass everything through `setState`'s functional updater instead.
2. **Store mutable identifiers in a `ref`** (e.g. `proposalIdRef.current`) when you need to filter events without adding the value to `useCallback` deps.
3. **Always return the unsubscribe function** from `useEffect` so the handler is removed when the component unmounts.
4. **Keep `useCallback` deps minimal and stable** — prefer context values that are themselves wrapped in `useCallback`/`useMemo`.
5. **Separate concerns** — put subscription logic in a dedicated hook (e.g. `useProposalRealtime`) and keep display components pure/presentational.

See `src/hooks/useProposalRealtime.ts` for the canonical implementation and
`src/hooks/__tests__/useProposalRealtime.test.ts` for tests that explicitly
guard against regressions.

## 🔄 Contribution Workflow

### 1. Create a Branch

Use descriptive branch names:

```bash
git checkout -b feature/add-proposal-list
git checkout -b fix/timelock-calculation
git checkout -b docs/update-deployment-guide
```

### 2. Make Your Changes

- Write clean, readable code
- Add comments for complex logic
- Update documentation if needed
- Add tests for new features

### 3. Test Your Changes

**Smart Contract:**

```bash
cd contracts/vault
cargo test
cargo clippy
cargo fmt --check
```

**Frontend:**

```bash
cd frontend
npm run build  # Ensure it builds
npm run lint   # Check for linting errors
```

### 4. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: add proposal list component"
git commit -m "fix: correct timelock calculation in execute_proposal"
git commit -m "docs: update DEPLOYMENT.md with testnet steps"
```

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `test:` - Adding or updating tests
- `refactor:` - Code refactoring
- `chore:` - Maintenance tasks

### 5. Push and Create a Pull Request

```bash
git push origin your-branch-name
```

Then create a PR on GitHub with:

- Clear title describing the change
- Description of what changed and why
- Reference to related issues (e.g., "Closes #42")
- Screenshots for UI changes

## 🧪 Testing

For the full testing guide — including how to run tests, write new ones, set up coverage, and understand CI requirements — see **[docs/reference/TESTING.md](docs/reference/TESTING.md)**.

## 🎯 Frontend contribution guide

For frontend-specific design system + widget development conventions, see **[docs/guides/FRONTEND_CONTRIBUTION.md](docs/guides/FRONTEND_CONTRIBUTION.md)**.

## 🎯 SDK contribution guide

For SDK-specific setup, running tests, adding a new contract binding, versioning, and publishing, see **[sdk/CONTRIBUTING.md](sdk/CONTRIBUTING.md)**.

## 🎯 First contribution walkthrough

New contributors should start with the hands-on guide: **[docs/guides/FIRST_CONTRIBUTION.md](docs/guides/FIRST_CONTRIBUTION.md)**.

It includes:

- Verified environment setup (Linux/macOS/Windows via WSL2)
- How to pick your first issue
- A worked example adding a small contract getter
- What reviewers look for during code review

### Testing Requirements

### For Smart Contract Changes

- All existing tests must pass (`cargo test`)
- Add new tests for new functionality in `contracts/vault/src/test.rs`
- Aim for comprehensive coverage of edge cases
- Test both success and failure scenarios
- Use `try_*` variants to assert on error types

### For Frontend Changes

- Ensure the app builds without errors (`npm run build`)
- Write or update Vitest tests for new components/hooks (see [TESTING.md](docs/reference/TESTING.md#4-writing-component-tests))
- Test manually in the browser
- Verify wallet integration works (if applicable)
- Check responsive design on mobile

## 📋 Pull Request Checklist

Before submitting your PR, ensure:

- [ ] Code follows style guidelines (`cargo fmt`, `npm run lint`)
- [ ] All tests pass (`cargo test`, `npm run build`)
- [ ] New functionality includes tests
- [ ] Documentation is updated (if needed)
- [ ] Commit messages are clear and descriptive
- [ ] PR description explains the changes
- [ ] No merge conflicts with `main`

## 🔍 Code Review Process

1. **Automated Checks**: CI will run tests and linting
2. **Maintainer Review**: A maintainer will review your code
3. **Feedback**: Address any requested changes
4. **Approval**: Once approved, your PR will be merged
5. **Recognition**: Contributors are acknowledged in releases!

## 🔒 Dependency Security Audits

The `backend-checks` CI job runs `npm audit --audit-level=high --production` against `backend/`, failing the build on any high or critical severity vulnerability in a **production** dependency (dev-only dependencies are excluded via `--production`, since they never ship to runtime).

### Adding an audit exception

Sometimes a flagged vulnerability has no available fix (no patched version yet, or the vulnerable code path isn't reachable from VaultDAO's usage). In that case:

1. Confirm the vulnerability doesn't affect us — read the advisory and check whether the vulnerable function/flow is actually exercised.
2. Try `npm audit fix` first; only proceed with an exception if that doesn't resolve it.
3. Open an issue documenting: the advisory ID (e.g. `GHSA-...`), why it doesn't apply or can't yet be fixed, and a link to the upstream issue/PR tracking a real fix.
4. Add the advisory ID to `backend/.audit-exceptions.json` (create the file if it doesn't exist) with a short reason and the tracking issue link:

   ```json
   {
     "GHSA-xxxx-xxxx-xxxx": {
       "reason": "Vulnerable code path is not reachable — see explanation in the issue.",
       "issue": "https://github.com/rdj-savyy/VaultDAO/issues/<number>"
     }
   }
   ```

5. Update the CI step to pass `--omit-dev` findings covered by that file through `npm audit --audit-level=high --production --json | jq` filtering, or use [`better-npm-audit`](https://www.npmjs.com/package/better-npm-audit) with `--exclude <advisory-id>` if the exceptions list grows.
6. Re-review exceptions periodically — an exception is a temporary waiver, not a permanent suppression. Remove it as soon as a patched version is available.

Never silence an audit failure by lowering `--audit-level` or dropping `--production` — that hides real production-facing vulnerabilities, not just the one you're trying to except.

## 🐛 Reporting Bugs

Found a bug? Please [open an issue](https://github.com/NovaGrids/VaultDAO/issues/new?template=bug_report.md) with:

- Clear description of the bug
- Steps to reproduce
- Expected vs actual behavior
- Environment details (OS, browser, versions)
- Screenshots or error logs

## 💡 Suggesting Features

Have an idea? [Open a feature request](https://github.com/NovaGrids/VaultDAO/issues/new?template=feature_request.md) with:

- Problem you're trying to solve
- Proposed solution
- Alternative approaches considered
- Any additional context

## 📚 Resources

- [Soroban Documentation](https://soroban.stellar.org/docs)
- [Stellar SDK](https://stellar.github.io/js-stellar-sdk/)
- [Freighter Wallet API](https://docs.freighter.app/)
- [React Documentation](https://react.dev/)
- [Tailwind CSS](https://tailwindcss.com/docs)

## 🤝 Code of Conduct

This project adheres to a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to the maintainers.

## ❓ Questions?

- **General Questions**: Open a [Discussion](https://github.com/NovaGrids/VaultDAO/discussions)
- **Technical Issues**: Open an [Issue](https://github.com/NovaGrids/VaultDAO/issues)

---

Thank you for contributing to VaultDAO! Together we're building the future of treasury management on Stellar. 🚀
