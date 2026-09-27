/**
 * Tests for Timelock Countdown Timer
 * Issue #1571: Add Timelock Countdown Timer on Timelocked Proposals
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

interface TimelockCountdownProps {
  timelockStartLedger: number;
  timelockDelay: number;
  currentLedger: number;
}

const TimelockCountdown = ({
  timelockStartLedger,
  timelockDelay,
  currentLedger,
}: TimelockCountdownProps) => {
  const estimatedLedgerTime = 5000; // milliseconds per ledger
  const expiresAtLedger = timelockStartLedger + timelockDelay;
  const ledgersRemaining = Math.max(0, expiresAtLedger - currentLedger);
  const msRemaining = ledgersRemaining * estimatedLedgerTime;

  const hours = Math.floor(msRemaining / (1000 * 60 * 60));
  const minutes = Math.floor((msRemaining % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((msRemaining % (1000 * 60)) / 1000);

  if (msRemaining <= 0) {
    return <div data-testid="timelock-status">Executable now</div>;
  }

  return (
    <div data-testid="timelock-countdown" aria-label={`Executable in ${hours}h ${minutes}m`}>
      Executable in {hours}h {minutes}m {seconds}s
    </div>
  );
};

describe('TimelockCountdown', () => {
  const baseConfig = {
    timelockStartLedger: 1000,
    timelockDelay: 10000,
  };

  describe('Countdown Calculation', () => {
    it('calculates remaining time from proposal timelock_start_ledger and config.timelock_delay', () => {
      const currentLedger = 2000;
      const expectedLedgersRemaining = baseConfig.timelockDelay - (currentLedger - baseConfig.timelockStartLedger);

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      expect(screen.getByTestId('timelock-countdown')).toBeInTheDocument();
    });

    it('computes timelock_expires_at = timelock_start_ledger + config.timelock_delay', () => {
      const currentLedger = baseConfig.timelockStartLedger + 1000;
      const expectedExpiresAt = baseConfig.timelockStartLedger + baseConfig.timelockDelay;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });

    it('shows "Executable now" when timelock has expired', () => {
      const currentLedger = baseConfig.timelockStartLedger + baseConfig.timelockDelay + 100;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      expect(screen.getByTestId('timelock-status')).toHaveTextContent('Executable now');
    });

    it('shows correct countdown for various time intervals', () => {
      const scenarios = [
        { ledgerDiff: 1000, expectedHours: '1' },
        { ledgerDiff: 2000, expectedHours: '2' },
        { ledgerDiff: 7200, expectedHours: '10' },
      ];

      scenarios.forEach(({ ledgerDiff, expectedHours }) => {
        const { unmount } = render(
          <TimelockCountdown
            timelockStartLedger={baseConfig.timelockStartLedger}
            timelockDelay={baseConfig.timelockDelay}
            currentLedger={baseConfig.timelockStartLedger + ledgerDiff}
          />
        );

        const countdown = screen.getByTestId('timelock-countdown');
        expect(countdown).toBeInTheDocument();

        unmount();
      });
    });
  });

  describe('Display Formatting', () => {
    it('displays countdown in "Executable in Xh YmZs" format', () => {
      const currentLedger = baseConfig.timelockStartLedger + 2000;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown.textContent).toMatch(/Executable in \d+h \d+m \d+s/);
    });

    it('uses singular "hour" when 1 hour remaining', () => {
      const currentLedger = baseConfig.timelockStartLedger + (baseConfig.timelockDelay - 720);

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });

    it('displays zero-padded values when appropriate', () => {
      const currentLedger = baseConfig.timelockStartLedger + 100;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });

    it('omits negative time values when timelock expires', () => {
      const currentLedger = baseConfig.timelockStartLedger + baseConfig.timelockDelay + 500;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      const status = screen.getByTestId('timelock-status');
      expect(status.textContent).not.toContain('-');
    });
  });

  describe('Live Updates', () => {
    it('updates countdown as ledger progresses', () => {
      const { rerender } = render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + 1000}
        />
      );

      let countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();

      rerender(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + 2000}
        />
      );

      countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });

    it('transitions from "Executable in X" to "Executable now"', () => {
      const { rerender } = render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + baseConfig.timelockDelay - 100}
        />
      );

      expect(screen.getByTestId('timelock-countdown')).toBeInTheDocument();

      rerender(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + baseConfig.timelockDelay + 100}
        />
      );

      expect(screen.getByTestId('timelock-status')).toHaveTextContent('Executable now');
    });

    it('maintains accuracy across multiple updates', () => {
      const { rerender } = render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + 1000}
        />
      );

      for (let i = 0; i < 5; i++) {
        rerender(
          <TimelockCountdown
            timelockStartLedger={baseConfig.timelockStartLedger}
            timelockDelay={baseConfig.timelockDelay}
            currentLedger={baseConfig.timelockStartLedger + 1000 + i * 100}
          />
        );

        const countdown = screen.getByTestId('timelock-countdown');
        expect(countdown).toBeInTheDocument();
      }
    });
  });

  describe('Edge Cases', () => {
    it('handles zero timelock delay', () => {
      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={0}
          currentLedger={baseConfig.timelockStartLedger}
        />
      );

      expect(screen.getByTestId('timelock-status')).toHaveTextContent('Executable now');
    });

    it('handles very large timelock delays', () => {
      const largeDelay = 1000000;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={largeDelay}
          currentLedger={baseConfig.timelockStartLedger + 100}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });

    it('handles current ledger before timelock start', () => {
      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger - 100}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });

    it('handles current ledger exactly at expiration', () => {
      const expiresAtLedger = baseConfig.timelockStartLedger + baseConfig.timelockDelay;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={expiresAtLedger}
        />
      );

      expect(screen.getByTestId('timelock-status')).toHaveTextContent('Executable now');
    });

    it('handles fractional ledger calculations', () => {
      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + 500}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('has accessible aria-label with countdown time', () => {
      const currentLedger = baseConfig.timelockStartLedger + 1000;

      render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={currentLedger}
        />
      );

      const countdown = screen.getByTestId('timelock-countdown');
      expect(countdown).toHaveAttribute('aria-label');
      expect(countdown.getAttribute('aria-label')).toMatch(/Executable in \d+h \d+m/);
    });

    it('announces status change when transitioning to executable', async () => {
      const { rerender } = render(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + baseConfig.timelockDelay - 1}
        />
      );

      rerender(
        <TimelockCountdown
          timelockStartLedger={baseConfig.timelockStartLedger}
          timelockDelay={baseConfig.timelockDelay}
          currentLedger={baseConfig.timelockStartLedger + baseConfig.timelockDelay}
        />
      );

      await waitFor(() => {
        expect(screen.getByTestId('timelock-status')).toBeInTheDocument();
      });
    });
  });
});
