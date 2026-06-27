import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import OnboardingFlow from '../OnboardingFlow';

const mockWallet = {
  isConnected: false,
  address: 'GTESTWALLET',
  accountRole: 'Member' as string | null,
};

const mockOnboarding = {
  isOnboardingActive: true,
  skipOnboarding: vi.fn(),
  completeStep: vi.fn(),
};

vi.mock('../../hooks/useWallet', () => ({
  useWallet: () => mockWallet,
}));

vi.mock('../../context/OnboardingProvider', () => ({
  useOnboarding: () => mockOnboarding,
}));

describe('OnboardingFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockWallet.isConnected = false;
    mockWallet.address = 'GTESTWALLET';
    mockWallet.accountRole = 'Member';
    mockOnboarding.isOnboardingActive = true;
  });

  it('renders wallet-link step first and hides skip button', () => {
    render(<OnboardingFlow />);

    expect(screen.getByText('Link Your Wallet')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /skip for now/i })).not.toBeInTheDocument();
  });

  it('renders role-specific branch for Admin users', () => {
    mockWallet.accountRole = 'Admin';
    mockWallet.isConnected = true;

    render(<OnboardingFlow />);

    expect(screen.getByText('Admin Console Overview')).toBeInTheDocument();
  });

  it('allows skipping non-wallet steps and persists skipped metrics', () => {
    mockWallet.isConnected = true;

    render(<OnboardingFlow />);

    fireEvent.click(screen.getByRole('button', { name: /skip for now/i }));

    const stored = localStorage.getItem('vaultdao_onboarding_metrics_GTESTWALLET');
    expect(stored).toBeTruthy();
    expect(stored).toContain('member-overview');
  });

  it('persists completed steps on next', () => {
    mockWallet.isConnected = true;

    render(<OnboardingFlow />);

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    const stored = localStorage.getItem('vaultdao_onboarding_metrics_GTESTWALLET');
    expect(stored).toContain('member-overview');
    expect(mockOnboarding.completeStep).toHaveBeenCalledWith('member-overview');
  });

  it('restores progress from localStorage on mount', () => {
    localStorage.setItem(
      'vaultdao_onboarding_metrics_GTESTWALLET',
      JSON.stringify({
        role: 'Member',
        currentStepIndex: 2,
        completedStepIds: ['wallet-link', 'member-overview'],
        skippedStepIds: [],
        updatedAt: Date.now(),
      }),
    );

    mockWallet.isConnected = false;
    render(<OnboardingFlow />);

    expect(screen.getByText('Governance Voting Mechanics')).toBeInTheDocument();
  });
});
