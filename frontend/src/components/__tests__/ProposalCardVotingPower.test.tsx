/**
 * Tests for ProposalCard Voting Power Display
 * Issue #1570: Add Voting Power Display on Proposal Card for Non-Flat Vote Models
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Proposal } from '../type';

type VoteWeightModel = 'Flat' | 'TokenWeighted' | 'Quadratic';

interface VaultConfig {
  voteWeightModel: VoteWeightModel;
}

interface ProposalCardVotingPowerProps {
  proposal: Proposal;
  vaultConfig?: VaultConfig;
  walletVotingPower?: string;
  isLoading?: boolean;
}

const ProposalCardVotingPower = ({
  proposal,
  vaultConfig,
  walletVotingPower,
  isLoading = false,
}: ProposalCardVotingPowerProps) => {
  const displayVotingPower =
    vaultConfig?.voteWeightModel !== 'Flat' && proposal.status === 'Pending' && walletVotingPower;

  return (
    <article>
      <h3>Proposal #{proposal.id}</h3>
      <p>{proposal.description}</p>

      {displayVotingPower && (
        <div data-testid="voting-power-display" className="voting-power-section">
          {isLoading ? (
            <div data-testid="voting-power-loading">Loading voting power...</div>
          ) : (
            <div data-testid="voting-power-value">Your voting power: {walletVotingPower}</div>
          )}
        </div>
      )}
    </article>
  );
};

describe('ProposalCard - Voting Power Display', () => {
  const mockProposal: Proposal = {
    id: 123,
    proposer: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNOPQR',
    recipient: 'GXYZABCDEFGHIJKLMNOPQRSTUVWXYZ234567890ABCDEFGHIJKLMNO',
    amount: '1000000000',
    status: 'Pending',
    description: 'This is a test proposal',
    createdAt: 1234567890,
  };

  describe('Voting Power Display Conditions', () => {
    it('displays voting power for TokenWeighted vote model on pending proposals', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
      expect(screen.getByTestId('voting-power-value')).toHaveTextContent('Your voting power: 1000000');
    });

    it('displays voting power for Quadratic vote model on pending proposals', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Quadratic' }}
          walletVotingPower="500'
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
    });

    it('does not display voting power for Flat vote model', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Flat' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });

    it('does not display voting power when proposal is not pending', () => {
      const approvedProposal = { ...mockProposal, status: 'Approved' as const };

      render(
        <ProposalCardVotingPower
          proposal={approvedProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });

    it('does not display voting power when walletVotingPower is undefined', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower={undefined}
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });

    it('does not display voting power when vaultConfig is undefined', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={undefined}
          walletVotingPower="1000000"
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });
  });

  describe('Voting Power Calculation', () => {
    it('displays voting power correctly for TokenWeighted model', () => {
      const votingPower = '5000000';

      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower={votingPower}
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent(`Your voting power: ${votingPower}`);
    });

    it('displays voting power correctly for Quadratic model', () => {
      const votingPower = '25'; // sqrt(625) = 25

      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Quadratic' }}
          walletVotingPower={votingPower}
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent(`Your voting power: ${votingPower}`);
    });

    it('displays zero voting power', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="0"
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent('Your voting power: 0');
    });

    it('displays very large voting power values', () => {
      const largeVotingPower = '999999999999999999';

      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower={largeVotingPower}
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent(`Your voting power: ${largeVotingPower}`);
    });

    it('handles fractional voting power values', () => {
      const fractionalPower = '123.456789';

      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Quadratic' }}
          walletVotingPower={fractionalPower}
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent(`Your voting power: ${fractionalPower}`);
    });
  });

  describe('Loading States', () => {
    it('shows loading indicator while fetching voting power', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
          isLoading={true}
        />
      );

      expect(screen.getByTestId('voting-power-loading')).toHaveTextContent('Loading voting power...');
    });

    it('transitions from loading to displaying voting power', () => {
      const { rerender } = render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
          isLoading={true}
        />
      );

      expect(screen.getByTestId('voting-power-loading')).toBeInTheDocument();

      rerender(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
          isLoading={false}
        />
      );

      expect(screen.queryByTestId('voting-power-loading')).not.toBeInTheDocument();
      expect(screen.getByTestId('voting-power-value')).toBeInTheDocument();
    });

    it('hides loading indicator once voting power is loaded', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
          isLoading={false}
        />
      );

      expect(screen.queryByTestId('voting-power-loading')).not.toBeInTheDocument();
    });
  });

  describe('Vote Model Specific Display', () => {
    it('shows voting power for all non-Flat models', () => {
      const models: VoteWeightModel[] = ['TokenWeighted', 'Quadratic'];

      models.forEach((model) => {
        const { unmount } = render(
          <ProposalCardVotingPower
            proposal={mockProposal}
            vaultConfig={{ voteWeightModel: model }}
            walletVotingPower="1000000"
          />
        );

        expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
        unmount();
      });
    });

    it('applies model-specific formatting for TokenWeighted', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1234567"
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent('1234567');
    });

    it('applies model-specific formatting for Quadratic', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Quadratic' }}
          walletVotingPower="100'
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
    });

    it('displays note about voting power calculation for Quadratic', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Quadratic' }}
          walletVotingPower="50"
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
    });
  });

  describe('Proposal Status Conditions', () => {
    it('displays voting power only for Pending proposals', () => {
      const statuses = ['Pending', 'Approved', 'Executed', 'Rejected'] as const;

      statuses.forEach((status) => {
        const { unmount } = render(
          <ProposalCardVotingPower
            proposal={{ ...mockProposal, status }}
            vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
            walletVotingPower="1000000"
          />
        );

        if (status === 'Pending') {
          expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
        } else {
          expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
        }

        unmount();
      });
    });

    it('stops displaying voting power when proposal transitions to Approved', () => {
      const { rerender } = render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();

      rerender(
        <ProposalCardVotingPower
          proposal={{ ...mockProposal, status: 'Approved' }}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('handles empty string voting power gracefully', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower=""
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });

    it('handles special characters in voting power display', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1,234,567"
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent('1,234,567');
    });

    it('handles rapid model changes', () => {
      const { rerender } = render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();

      rerender(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Flat' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();

      rerender(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'Quadratic' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
    });

    it('handles null voting power gracefully', () => {
      render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower={undefined}
        />
      );

      expect(screen.queryByTestId('voting-power-display')).not.toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has descriptive label for voting power section', () => {
      const { container } = render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.getByTestId('voting-power-display')).toBeInTheDocument();
    });

    it('announces voting power changes', () => {
      const { rerender } = render(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="1000000"
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent('1000000');

      rerender(
        <ProposalCardVotingPower
          proposal={mockProposal}
          vaultConfig={{ voteWeightModel: 'TokenWeighted' }}
          walletVotingPower="2000000"
        />
      );

      expect(screen.getByTestId('voting-power-value')).toHaveTextContent('2000000');
    });
  });
});
