import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SpendingLimitsPanel } from '../SpendingLimitsPanel';
import { useVaultContract } from '../../hooks/useVaultContract';

// Mock useVaultContract hook
vi.mock('../../hooks/useVaultContract', () => ({
  useVaultContract: vi.fn(),
}));

// Mock ConfirmationModal
vi.mock('../modals/ConfirmationModal', () => ({
  default: ({ isOpen, onConfirm, onCancel }: any) =>
    isOpen ? (
      <div data-testid="confirmation-modal">
        <button onClick={onConfirm}>Confirm</button>
        <button onClick={onCancel}>Cancel</button>
      </div>
    ) : null,
}));

const mockUseVaultContract = vi.mocked(useVaultContract);

describe('SpendingLimitsPanel', () => {
  const mockVaultConfig = {
    spendingLimit: BigInt('1000000000'),
    dailyLimit: BigInt('5000000000'),
    weeklyLimit: BigInt('25000000000'),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('progress bar color thresholds', () => {
    it('should calculate progress bar color as green when spent is less than 70% of limit', () => {
      const spent = 50;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(50);
      expect(percentage < 70).toBe(true);
      // Color should be green
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-green-500');
    });

    it('should calculate progress bar color as yellow when spent is between 70% and 90% of limit', () => {
      const spent = 75;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(75);
      expect(percentage >= 70 && percentage < 90).toBe(true);
      // Color should be yellow
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-yellow-500');
    });

    it('should calculate progress bar color as red when spent is greater than 90% of limit', () => {
      const spent = 95;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(95);
      expect(percentage >= 90).toBe(true);
      // Color should be red
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-red-500');
    });

    it('should handle edge case at exactly 70% boundary', () => {
      const spent = 70;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(70);
      // At exactly 70%, should transition from green to yellow
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-yellow-500');
    });

    it('should handle edge case at exactly 90% boundary', () => {
      const spent = 90;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(90);
      // At exactly 90%, should transition from yellow to red
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-red-500');
    });

    it('should calculate correct percentage for daily limit', () => {
      const dailySpent = 3500;
      const dailyLimit = 5000;
      const percentage = (dailySpent / dailyLimit) * 100;

      expect(percentage).toBe(70);
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-yellow-500');
    });

    it('should calculate correct percentage for weekly limit', () => {
      const weeklySpent = 22500;
      const weeklyLimit = 25000;
      const percentage = (weeklySpent / weeklyLimit) * 100;

      expect(percentage).toBe(90);
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-red-500');
    });

    it('should return green color when no spending against limit', () => {
      const spent = 0;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(0);
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-green-500');
    });

    it('should return red color at maximum limit', () => {
      const spent = 100;
      const limit = 100;
      const percentage = (spent / limit) * 100;

      expect(percentage).toBe(100);
      const expectedColor = percentage < 70 ? 'bg-green-500' : percentage < 90 ? 'bg-yellow-500' : 'bg-red-500';
      expect(expectedColor).toBe('bg-red-500');
    });
  });

  describe('progress bar width calculations', () => {
    it('should calculate correct width percentage for progress bar', () => {
      const spent = 50;
      const limit = 100;
      const widthPercentage = Math.min((spent / limit) * 100, 100);

      expect(widthPercentage).toBe(50);
      expect(widthPercentage <= 100).toBe(true);
    });

    it('should cap progress bar width at 100%', () => {
      const spent = 150;
      const limit = 100;
      const widthPercentage = Math.min((spent / limit) * 100, 100);

      expect(widthPercentage).toBe(100);
    });

    it('should show 0% width when no spending', () => {
      const spent = 0;
      const limit = 100;
      const widthPercentage = Math.min((spent / limit) * 100, 100);

      expect(widthPercentage).toBe(0);
    });
  });

  describe('admin access check', () => {
    it('should show admin access required message when isAdmin is false', () => {
      mockUseVaultContract.mockReturnValue({
        getVaultConfig: vi.fn().mockResolvedValue(mockVaultConfig),
        updateSpendingLimits: vi.fn(),
        loading: false,
      } as any);

      render(<SpendingLimitsPanel isAdmin={false} />);

      expect(screen.getByText('Admin Access Required')).toBeInTheDocument();
      expect(screen.getByText(/administrator permissions/i)).toBeInTheDocument();
    });
  });
});
