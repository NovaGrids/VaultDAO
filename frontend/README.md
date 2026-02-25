# Stellar DApp Frontend

A decentralized application frontend built with React, TypeScript, and Vite for Stellar blockchain integration.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

## Features

- 🎤 **Voice Commands** - Hands-free navigation and actions with Web Speech API
- 🎯 **Voice-to-Text** - Speech input for all form fields
- 🔊 **Voice Feedback** - Audio confirmation of actions
- 📱 **Mobile Responsive** - Full voice support on mobile devices
- ♿ **Accessibility** - Enhanced accessibility with voice controls

See [VOICE_COMMANDS.md](./VOICE_COMMANDS.md) for detailed voice feature documentation.

## Table of Contents
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Environment Setup](#environment-setup)
- [Installation](#installation)
- [Running the Project](#running-the-project)
- [Building for Production](#building-for-production)
- [Stellar Testnet Setup](#stellar-testnet-setup)
- [Voice Commands](#voice-commands)
- [Troubleshooting](#troubleshooting)
- [Development Tools](#development-tools)
- [Contributing](#contributing)

## Prerequisites

Before you begin, ensure you have the following installed:
- **Node.js** (v16 or higher) - [Download here](https://nodejs.org/)
- **npm** or **yarn** package manager
- **Git** - [Download here](https://git-scm.com/)
- A code editor (we recommend [VS Code](https://code.visualstudio.com/))

## Environment Setup

### 1. Create Your Environment File

This project uses environment variables for Stellar network configuration. Follow these steps to set up your environment:

**Step 1:** Copy the example environment file
```bash
cp .env.example .env
```

**Step 2:** Open the `.env` file in your text editor

**Step 3:** Update the values according to your setup (see below for guidance)

### 2. Required Environment Variables

#### Stellar Network Configuration

| Variable | Description | Example Value |
|----------|-------------|---------------|
| `VITE_STELLAR_NETWORK` | Network to use (testnet/mainnet) | `testnet` |
| `VITE_STELLAR_NETWORK_PASSPHRASE` | Network passphrase for transaction signing | `Test SDF Network ; September 2015` |
| `VITE_HORIZON_URL` | Horizon API endpoint for blockchain data | `https://horizon-testnet.stellar.org` |
| `VITE_SOROBAN_RPC_URL` | Soroban RPC endpoint for smart contracts | `https://soroban-testnet.stellar.org` |

#### Smart Contract Configuration

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `VITE_CONTRACT_ADDRESS` | Your deployed smart contract address | Obtained after deploying your Soroban contract |
| `VITE_CONTRACT_ID` | Contract identifier (usually same as address) | Same as contract address |

#### Optional Configuration

| Variable | Description | Default Value |
|----------|-------------|---------------|
| `VITE_APP_ENV` | Application environment | `development` |
| `VITE_DEBUG_MODE` | Enable debug logging | `true` |

### 3. Where to Get Configuration Values

#### For Stellar Testnet (Development)
Use these values in your `.env` file for testing:

- **Network:** `testnet`
- **Horizon URL:** `https://horizon-testnet.stellar.org`
- **Soroban RPC URL:** `https://soroban-testnet.stellar.org`
- **Network Passphrase:** `Test SDF Network ; September 2015`

#### For Stellar Mainnet (Production)
⚠️ Only use these when deploying to production:

- **Network:** `mainnet`
- **Horizon URL:** `https://horizon.stellar.org`
- **Soroban RPC URL:** `https://soroban-mainnet.stellar.org`
- **Network Passphrase:** `Public Global Stellar Network ; September 2015`

#### Getting Your Contract Address

1. Deploy your Soroban smart contract following the [official documentation](https://soroban.stellar.org/docs/getting-started/deploy-to-testnet)
2. The deployment process will output your contract address
3. Copy this address to the `VITE_CONTRACT_ADDRESS` variable in your `.env` file

**Example deployment output:**
```bash
Contract deployed successfully!
Contract Address: CCXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

## Installation

Install project dependencies:
```bash
npm install
```

Or if you prefer yarn:
```bash
yarn install
```

## Running the Project

Start the development server with hot module replacement (HMR):
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

You should see output like:
```
VITE v5.x.x  ready in xxx ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
➜  press h + enter to show help
```

## Building for Production

Create an optimized production build:
```bash
npm run build
```

The build output will be in the `dist/` folder.

To preview the production build locally:
```bash
npm run preview
```

## Stellar Testnet Setup

To interact with the Stellar testnet, you'll need a funded account and basic understanding of the network.

### 1. Create a Stellar Testnet Account

**Option A: Using Stellar Laboratory (Recommended for Beginners)**
1. Visit [Stellar Laboratory Account Creator](https://laboratory.stellar.org/#account-creator?network=test)
2. Click **"Generate keypair"**
3. **CRITICAL:** Save both your **Public Key** and **Secret Key** securely
   - Public Key: Safe to share (like your account number)
   - Secret Key: NEVER share this (like your password)
4. Click **"Fund account with Friendbot"** to get test XLM

**Option B: Using Freighter Wallet (Recommended for General Use)**
1. Install [Freighter browser extension](https://www.freighter.app/)
2. Create a new wallet
3. Switch to Testnet in settings
4. Copy your public key
5. Fund it using [Friendbot](https://laboratory.stellar.org/#account-creator?network=test)

### 2. Fund Your Account with Test XLM

Test XLM (Lumens) are free tokens for development:

1. Copy your public key (starts with G...)
2. Go to [Stellar Laboratory Friendbot](https://laboratory.stellar.org/#account-creator?network=test)
3. Paste your public key
4. Click **"Get test network lumens"**
5. Your account will receive 10,000 test XLM

### 3. Verify Your Account

Check your account balance on [Stellar Expert Testnet Explorer](https://stellar.expert/explorer/testnet):
- Paste your public key in the search bar
- You should see your 10,000 XLM balance

### 4. Useful Stellar Resources

- **[Stellar Documentation](https://developers.stellar.org/)** - Official docs
- **[Soroban Smart Contracts](https://soroban.stellar.org/docs)** - Smart contract development
- **[Stellar Laboratory](https://laboratory.stellar.org/)** - Test and explore transactions
- **[Freighter Wallet](https://www.freighter.app/)** - Browser wallet extension
- **[Stellar Expert](https://stellar.expert/explorer/testnet)** - Testnet blockchain explorer
- **[Stellar Discord](https://discord.gg/stellardev)** - Community support
- **[Soroban Quest](https://quest.stellar.org/)** - Interactive learning

## Troubleshooting

### Environment Variable Issues

**Problem:** "Missing environment variables" error

**Solutions:**
- Verify you created `.env` file from `.env.example`
- Check all required variables are set (no empty values)
- Restart your development server after changing `.env`
- Ensure variable names start with `VITE_` prefix

**Check your variables:**
```bash
# Print environment variables (remove sensitive data first!)
cat .env
```

### Network Connection Issues

**Problem:** Cannot connect to Stellar network

**Solutions:**
- Verify you're using correct Horizon/RPC URLs for your network (testnet vs mainnet)
- Check your internet connection
- Verify Stellar services are operational at [Stellar Status](https://status.stellar.org/)
- Try switching to a different RPC endpoint

**Test your connection:**
```bash
# Test Horizon (should return JSON)
curl https://horizon-testnet.stellar.org/

# Test Soroban RPC (should return JSON)
curl https://soroban-testnet.stellar.org/
```

### Contract Not Found

**Problem:** "Contract not found" or invalid contract address

**Solutions:**
- Verify your contract address is correct (starts with C)
- Ensure contract is deployed to the network specified in `VITE_STELLAR_NETWORK`
- Check contract exists on [Stellar Expert](https://stellar.expert/explorer/testnet)
- Redeploy your contract if necessary

### Build Errors

**Problem:** Build fails with TypeScript errors

**Solutions:**
- Run `npm install` to ensure all dependencies are installed
- Clear node_modules and reinstall: `rm -rf node_modules && npm install`
- Check your TypeScript version: `npx tsc --version`
- Verify `tsconfig.json` is properly configured

### Port Already in Use

**Problem:** Port 5173 is already in use

**Solutions:**
```bash
# Kill the process using port 5173
# On Mac/Linux:
lsof -ti:5173 | xargs kill -9

# On Windows:
netstat -ano | findstr :5173
taskkill /PID <PID_NUMBER> /F

# Or use a different port:
npm run dev -- --port 3000
```

## Security Notes

⚠️ **CRITICAL - NEVER commit or share:**
- Your `.env` file (it's in `.gitignore` for this reason)
- Secret keys or private keys
- API keys or authentication tokens
- Production contract addresses (until deployed)

✅ **ALWAYS:**
- Use `.env.example` with placeholder values
- Keep your secret keys in a password manager
- Use environment variables for sensitive data
- Review `.gitignore` before committing

**If you accidentally commit secrets:**
1. Immediately revoke/regenerate them
2. Remove from git history using `git filter-branch` or BFG Repo-Cleaner
3. Force push changes (if safe to do so)

## Development Tools

### Available Vite Plugins

Currently, two official React plugins are available:

- **[@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react)** - Uses [Babel](https://babeljs.io/) for Fast Refresh
- **[@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react-swc/blob/main/packages/plugin-react-swc)** - Uses [SWC](https://swc.rs/) for Fast Refresh (faster builds)

### React Compiler

The React Compiler is not enabled by default due to its impact on dev & build performance. To add it, see [React Compiler Installation](https://react.dev/learn/react-compiler/installation).

### Expanding the ESLint Configuration

If you're developing a production application, we recommend updating the ESLint configuration to enable type-aware lint rules:
```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Remove tseslint.configs.recommended and replace with:
      tseslint.configs.recommendedTypeChecked,
      // Or for stricter rules:
      tseslint.configs.strictTypeChecked,
      // Optionally add stylistic rules:
      tseslint.configs.stylisticTypeChecked,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```

You can also install React-specific lint rules:
```bash
npm install --save-dev eslint-plugin-react-x eslint-plugin-react-dom
```
```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
])
```

## Voice Commands

VaultDAO includes comprehensive voice command support for accessibility and hands-free operation.

### Quick Start

1. Click the microphone button in the bottom-right corner
2. Grant microphone permission when prompted
3. Say a command like "proposals" or "create proposal"
4. Voice feedback confirms your action

### Available Commands

**Navigation:**
- "dashboard", "home", "overview" - Go to dashboard
- "proposals" - View proposals
- "activity" - View activity
- "analytics" - View analytics
- "settings" - Open settings

**Actions:**
- "create proposal", "new proposal" - Create new proposal
- "approve" - Approve selected proposal
- "reject" - Reject selected proposal

### Voice-to-Text

Form inputs support voice-to-text. Click the microphone icon in any input field to speak your input.

### Documentation

- [VOICE_COMMANDS.md](./VOICE_COMMANDS.md) - Complete voice features documentation
- [VOICE_EXAMPLES.md](./VOICE_EXAMPLES.md) - Usage examples and code snippets

## Contributing

We welcome contributions! Please see [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

Before submitting a PR:
1. Ensure all tests pass
2. Follow the existing code style
3. Update documentation as needed
4. Test your changes thoroughly

## License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.

---

**Built with ❤️ using React, TypeScript, Vite, and Stellar**
