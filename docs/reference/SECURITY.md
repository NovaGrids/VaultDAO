# Security Policy

## Supported Versions

VaultDAO is currently in **Beta (Open Source MVP)**. We are focusing our security efforts on the latest major versions.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

If you discover a potential security vulnerability in VaultDAO, please report it via private disclosure. We take security seriously and will work with you to address the issue promptly.

### Disclosure Process

1.  **Email**: Send a detailed report to [INSERT SECURITY EMAIL OR TG HANDLE].
2.  **Details**: Include a description of the vulnerability, steps to reproduce, and potential impact.
3.  **Acknowledgement**: We will acknowledge receipt of your report within 48 hours.
4.  **Fix**: We will work on a fix and provide updates on our progress.
5.  **Release**: Once the fix is verified, we will release a new version and provide public credit if desired.

## Security Considerations for VaultDAO

VaultDAO handles treasury funds, making security our highest priority. The following measures are implemented:

- **Rust for Memory Safety**: The smart contract is written in Rust to prevent common vulnerabilities like buffer overflows.
- **Soroban Sandboxing**: The contract runs in the Soroban host environment, which enforces strict resource limits and security boundaries.
- **Multi-Signature Logic**: Critical actions (like transfers or configuration changes) require M-of-N signatures.
- **Timelocks**: Large transfers are delayed for a specified period (e.g., 24 hours), allowing admins to cancel them if they are unauthorized.
- **RBAC (Role-Based Access Control)**: Granular permissions ensure only authorized roles (Admin, Treasurer) can perform sensitive actions.

## Audits

VaultDAO has **not yet undergone a formal third-party security audit**. Users should interact with the platform at their own risk and avoid depositing significant funds until an audit is completed.

We plan to engage security auditors once the core feature set is finalized. See [`AUDIT_SCOPE.md`](./AUDIT_SCOPE.md) for the attack surface catalogue, known invariants, and current findings that will guide that audit.
