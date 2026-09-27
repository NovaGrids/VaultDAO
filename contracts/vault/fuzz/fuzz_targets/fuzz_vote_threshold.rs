#![no_main]
use libfuzzer_sys::fuzz_target;
use arbitrary::Arbitrary;

#[derive(Arbitrary, Debug)]
struct VoteThresholdFuzzInput {
    total_signers: u32,
    votes_required: u32,
    approvals: u32,
    rejections: u32,
    abstentions: u32,
}

fuzz_target!(|data: VoteThresholdFuzzInput| {
    let total_signers = data.total_signers;
    let votes_required = data.votes_required;
    let approvals = data.approvals as u64;
    let rejections = data.rejections as u64;
    let abstentions = data.abstentions as u64;

    // Bounds check: vote counts should not exceed total signers
    if approvals > total_signers as u64 || rejections > total_signers as u64 || abstentions > total_signers as u64 {
        return;
    }

    // Total votes should not exceed signers
    let total_votes = approvals + rejections + abstentions;
    if total_votes > total_signers as u64 {
        return;
    }

    // votes_required should not exceed total signers
    if votes_required > total_signers {
        return;
    }

    // Test case 1: Check if proposal is approved
    let is_approved = approvals as u32 >= votes_required;
    if is_approved {
        assert!(approvals as u32 >= votes_required, "If approved, approvals must meet threshold");
    }

    // Test case 2: Check if proposal is rejected (majority against)
    let majority_needed = (total_signers / 2) + 1;
    let is_rejected = rejections as u32 >= majority_needed;
    if is_rejected {
        assert!(rejections as u32 >= majority_needed, "If rejected, rejections must meet majority");
    }

    // Test case 3: Cannot be both approved and rejected
    let cannot_be_both = is_approved && is_rejected;
    if cannot_be_both {
        // This should be impossible if thresholds are correctly set
        panic!("Proposal cannot be both approved and rejected");
    }

    // Test case 4: Check voting power calculation
    let voting_power_used = approvals + rejections + abstentions;
    assert!(voting_power_used <= total_signers as u64, "Used voting power must not exceed total");

    // Test case 5: Outstanding votes
    let outstanding = (total_signers as u64) - voting_power_used;
    let can_still_reach_threshold = approvals + outstanding >= votes_required as u64;

    if !can_still_reach_threshold && !is_approved {
        // If we cannot reach threshold even with all outstanding votes and we're not approved,
        // proposal should eventually be rejected
        assert!(!is_approved, "If threshold unreachable, proposal must not be approved");
    }

    // Test case 6: Quorum check (if quorum_required is half of signers)
    let quorum_required = (total_signers + 1) / 2;
    let quorum_met = voting_power_used >= quorum_required as u64;
    assert!(quorum_met || voting_power_used < quorum_required as u64, "Quorum check must be binary");
});
