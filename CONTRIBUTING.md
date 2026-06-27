# Contributing to VaultDAO

Thank you for your interest in contributing to VaultDAO! We're building the "Gnosis Safe of Stellar" and welcome contributions from developers of all skill levels.

## 🚀 Getting Started

### Prerequisites

Before contributing, ensure you have the following installed:

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
