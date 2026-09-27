#!/bin/bash
# VaultDAO Ledger Rent Cost Estimator
#
# Estimates monthly Soroban ledger rent (in XLM) for a vault's proposal and
# role storage, following the CAP-0066 rent formula and the TTL constants
# defined in contracts/vault/src/storage.rs. See docs/reference/STORAGE.md
# section 4 for the full derivation and a worked example.
#
# The rent rate (--rate-stroops-per-kb-per-ledger) is a network-wide value
# that changes with total Soroban state size (CAP-0066) — it is NOT a fixed
# constant. Look up the current value at https://lab.stellar.org/network-limits
# before using this script's output for real budgeting. The default below is
# an illustrative placeholder only.

set -e

DAY_IN_LEDGERS=17280
STROOPS_PER_XLM=10000000

# Defaults mirror docs/reference/STORAGE.md section 4.6 (10-signer vault)
PROPOSALS=100
SIGNERS=10
PROPOSAL_BASE_KB=0.4
PROPOSAL_PER_SIGNER_KB=0.06
PROPOSAL_TTL_DAYS=7
PROPOSAL_THRESHOLD_DAYS=3.5

ROLE_SIZE_KB=0.05
ROLE_TTL_DAYS=30
ROLE_THRESHOLD_DAYS=7

RATE_STROOPS_PER_KB_PER_LEDGER=1

usage() {
    cat <<EOF
Usage: ./estimate_rent.sh [options]

Estimates monthly Soroban ledger rent for a VaultDAO vault's proposal and
role storage (see docs/reference/STORAGE.md section 4).

Options:
  --proposals N                          Number of active proposals (default: $PROPOSALS)
  --signers N                            Number of vault signers (default: $SIGNERS)
  --proposal-base-kb N                   Fixed per-proposal size excluding signer fields, in KB (default: $PROPOSAL_BASE_KB)
  --proposal-per-signer-kb N             Extra size per signer added to approvals/snapshot fields, in KB (default: $PROPOSAL_PER_SIGNER_KB)
  --proposal-ttl-days N                  Proposal TTL in days, matches PROPOSAL_TTL (default: $PROPOSAL_TTL_DAYS)
  --proposal-threshold-days N            extend_ttl threshold for proposals, in days (default: $PROPOSAL_THRESHOLD_DAYS)
  --role-size-kb N                       Size of one Role(Address) entry, in KB (default: $ROLE_SIZE_KB)
  --role-ttl-days N                      Role TTL in days, matches INSTANCE_TTL (default: $ROLE_TTL_DAYS)
  --role-threshold-days N                extend_ttl threshold for roles, in days (default: $ROLE_THRESHOLD_DAYS)
  --rate-stroops-per-kb-per-ledger N     Live persistent rent rate (R/D from CAP-0066), in stroops (default: $RATE_STROOPS_PER_KB_PER_LEDGER, illustrative placeholder)
  -h, --help                             Show this help

Example (use the live rate from https://lab.stellar.org/network-limits):
  ./estimate_rent.sh --proposals 250 --signers 5 --rate-stroops-per-kb-per-ledger 0.4
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --proposals) PROPOSALS="$2"; shift 2 ;;
        --signers) SIGNERS="$2"; shift 2 ;;
        --proposal-base-kb) PROPOSAL_BASE_KB="$2"; shift 2 ;;
        --proposal-per-signer-kb) PROPOSAL_PER_SIGNER_KB="$2"; shift 2 ;;
        --proposal-ttl-days) PROPOSAL_TTL_DAYS="$2"; shift 2 ;;
        --proposal-threshold-days) PROPOSAL_THRESHOLD_DAYS="$2"; shift 2 ;;
        --role-size-kb) ROLE_SIZE_KB="$2"; shift 2 ;;
        --role-ttl-days) ROLE_TTL_DAYS="$2"; shift 2 ;;
        --role-threshold-days) ROLE_THRESHOLD_DAYS="$2"; shift 2 ;;
        --rate-stroops-per-kb-per-ledger) RATE_STROOPS_PER_KB_PER_LEDGER="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
    esac
done

awk -v proposals="$PROPOSALS" \
    -v signers="$SIGNERS" \
    -v proposal_base_kb="$PROPOSAL_BASE_KB" \
    -v proposal_per_signer_kb="$PROPOSAL_PER_SIGNER_KB" \
    -v proposal_ttl_days="$PROPOSAL_TTL_DAYS" \
    -v proposal_threshold_days="$PROPOSAL_THRESHOLD_DAYS" \
    -v role_size_kb="$ROLE_SIZE_KB" \
    -v role_ttl_days="$ROLE_TTL_DAYS" \
    -v role_threshold_days="$ROLE_THRESHOLD_DAYS" \
    -v rate="$RATE_STROOPS_PER_KB_PER_LEDGER" \
    -v day_in_ledgers="$DAY_IN_LEDGERS" \
    -v stroops_per_xlm="$STROOPS_PER_XLM" \
'
function renewals_per_month(ttl_days, threshold_days) {
    # extend_ttl(key, threshold, ttl) refreshes once remaining life drops
    # below threshold, so a hot entry renews roughly every (ttl - threshold)
    # days. See docs/reference/STORAGE.md section 4.3.
    return 30 / (ttl_days - threshold_days)
}

function rent_per_renewal(size_kb, ttl_days) {
    ledgers = ttl_days * day_in_ledgers
    return size_kb * ledgers * rate
}

BEGIN {
    proposal_size_kb = proposal_base_kb + (signers * proposal_per_signer_kb)

    proposal_rent_stroops = rent_per_renewal(proposal_size_kb, proposal_ttl_days)
    proposal_renewals = renewals_per_month(proposal_ttl_days, proposal_threshold_days)
    proposal_monthly_stroops = proposal_rent_stroops * proposal_renewals * proposals

    role_rent_stroops = rent_per_renewal(role_size_kb, role_ttl_days)
    role_renewals = renewals_per_month(role_ttl_days, role_threshold_days)
    role_monthly_stroops = role_rent_stroops * role_renewals * signers

    total_stroops = proposal_monthly_stroops + role_monthly_stroops

    printf "VaultDAO Ledger Rent Estimate\n"
    printf "==============================\n"
    printf "Inputs: %d proposals, %d signers, rate=%.4g stroops/KB/ledger%s\n\n", \
        proposals, signers, rate, (rate == 1 ? " (illustrative placeholder — see --help)" : "")

    printf "Proposal storage:\n"
    printf "  estimated size per proposal : %.3f KB (%.2f base + %d signers x %.3f KB)\n", \
        proposal_size_kb, proposal_base_kb, signers, proposal_per_signer_kb
    printf "  TTL                         : %g days (renews every ~%.1f days)\n", proposal_ttl_days, (proposal_ttl_days - proposal_threshold_days)
    printf "  renewals / month            : %.2f\n", proposal_renewals
    printf "  monthly cost                : %.6f XLM\n\n", proposal_monthly_stroops / stroops_per_xlm

    printf "Role storage:\n"
    printf "  estimated size per role     : %.3f KB\n", role_size_kb
    printf "  TTL                         : %g days (renews every ~%.1f days)\n", role_ttl_days, (role_ttl_days - role_threshold_days)
    printf "  renewals / month            : %.2f\n", role_renewals
    printf "  monthly cost                : %.6f XLM\n\n", role_monthly_stroops / stroops_per_xlm

    printf "------------------------------\n"
    printf "Estimated total: %.4f XLM/month\n", total_stroops / stroops_per_xlm
    printf "\nThis excludes other DataKey variants (comments, audit entries, streams,\n"
    printf "escrows, etc.) — see docs/reference/STORAGE.md section 4.2 for their\n"
    printf "approximate sizes if your vault uses those features heavily.\n"
}
'
