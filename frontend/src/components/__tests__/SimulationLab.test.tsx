import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SimulationLab from '../SimulationLab';
import {
  SIMULATION_LAB_FIXTURES,
  computeLimitAndBreakerPreview,
  parseTypedSdkError,
  type SimulationLabSdkAdapter,
} from '../../utils/simulationLab';

describe('SimulationLab (#2228)', () => {
  it('computes limit and circuit-breaker previews matching contract getter formulas on fixtures', () => {
    const fixture = SIMULATION_LAB_FIXTURES.healthy;
    // 10,000 XLM = 100_000_000_000 stroops
    const txAmount = 100_000_000_000n;
    const preview = computeLimitAndBreakerPreview(fixture, txAmount);

    // spendable = max(0, balance - earmarked - pending - locked)
    // = 500B - (50B + 20B + 30B) = 400B stroops (40,000 XLM)
    expect(preview.spendableStroops).toBe(400_000_000_000n);
    expect(preview.insufficientSpendable).toBe(false);

    // per-proposal limit: 100B <= 100B
    expect(preview.perProposal.exceeds).toBe(false);

    // daily: 50B + 100B = 150B / 250B => 60%, 100B remaining
    expect(preview.daily.usedAfterStroops).toBe(150_000_000_000n);
    expect(preview.daily.remainingAfterStroops).toBe(100_000_000_000n);
    expect(preview.daily.utilizationPercent).toBe(60);
    expect(preview.daily.exceeds).toBe(false);

    // weekly: 150B + 100B = 250B / 750B => 33.3%
    expect(preview.weekly.usedAfterStroops).toBe(250_000_000_000n);
    expect(preview.weekly.remainingAfterStroops).toBe(500_000_000_000n);
    expect(preview.weekly.exceeds).toBe(false);

    // breaker: 30B + 100B = 130B / 150B => 20B headroom (13.3%), not tripped
    expect(preview.breakerOutflowAfterStroops).toBe(130_000_000_000n);
    expect(preview.breakerHeadroomAfterStroops).toBe(20_000_000_000n);
    expect(preview.breakerHeadroomPercentAfter).toBe(13.3);
    expect(preview.willTripBreaker).toBe(false);
  });

  it('wires create, vote, execute, and swap actions to the SDK simulate adapter and renders accessible PASS summary', async () => {
    const simulate = vi.fn().mockResolvedValue({
      resources: {
        estimatedFeeStroops: 145_200n,
        resourceFeeStroops: 145_100n,
        baseFeeStroops: 100n,
        cpuInstructions: 1_850_000,
        memoryBytes: 620_000,
        readBytes: 4_200,
        writeBytes: 1_850,
        ledgerReads: 4,
        ledgerWrites: 2,
      },
      stateSummary: ['Simulated governance action cleanly'],
    });
    const adapter: SimulationLabSdkAdapter = { simulate };

    render(
      <SimulationLab
        fixture={SIMULATION_LAB_FIXTURES.healthy}
        sdkAdapter={adapter}
      />
    );

    const actions: Array<{ label: string; expected: string }> = [
      { label: 'Create Proposal', expected: 'create' },
      { label: 'Vote', expected: 'vote' },
      { label: 'Execute', expected: 'execute' },
      { label: 'Swap', expected: 'swap' },
    ];

    for (const item of actions) {
      fireEvent.click(screen.getByRole('tab', { name: item.label }));
      fireEvent.click(
        screen.getByRole('button', { name: /run dry-run simulation/i })
      );
      await waitFor(() => {
        expect(screen.getByRole('status')).toHaveTextContent('PASS');
      });
      const lastCall = simulate.mock.calls[simulate.mock.calls.length - 1];
      expect(lastCall[0].action).toBe(item.expected);
    }

    expect(simulate).toHaveBeenCalledTimes(4);
    expect(screen.getByText(/1,850,000/)).toBeInTheDocument();
  });

  it('surfaces typed SDK errors in an accessible alert when simulation fails', async () => {
    const adapter: SimulationLabSdkAdapter = {
      simulate: vi
        .fn()
        .mockRejectedValue(
          new Error('HostError: Error(Contract, #42) daily limit exceeded')
        ),
    };

    render(
      <SimulationLab
        fixture={SIMULATION_LAB_FIXTURES.healthy}
        sdkAdapter={adapter}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /run dry-run simulation/i })
    );

    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert).toHaveTextContent('ERROR');
      expect(alert).toHaveTextContent('ExceedsDailyLimit');
      expect(alert).toHaveTextContent('#42');
      expect(alert).toHaveTextContent(/daily spending limit/i);
    });

    // Verify parser handles breaker error code #1224 as well
    const parsed = parseTypedSdkError('HostError: Error(Contract, #1224)');
    expect(parsed.code).toBe(1224);
    expect(parsed.name).toBe('TokenCircuitBreakerTripped');
  });

  it('renders accessible CRITICAL warning state when the vault is paused', () => {
    render(<SimulationLab fixture={SIMULATION_LAB_FIXTURES.paused} />);

    const warning = screen.getByRole('alert');
    expect(warning).toHaveAttribute('data-warning-code', 'VAULT_PAUSED');
    expect(warning).toHaveTextContent('CRITICAL');
    expect(warning).toHaveTextContent(/vault is currently paused/i);
    expect(warning).toHaveTextContent(/manual_incident_response/i);
  });

  it('renders accessible stale oracle warning state (WARNING on create, CRITICAL on swap)', () => {
    render(
      <SimulationLab
        fixture={SIMULATION_LAB_FIXTURES.staleOracle}
        initialAction="create"
      />
    );

    const createWarning = screen.getByRole('alert');
    expect(createWarning).toHaveAttribute('data-warning-code', 'STALE_ORACLE');
    expect(createWarning).toHaveTextContent('WARNING');
    expect(createWarning).toHaveTextContent(/stale oracle price feed/i);

    fireEvent.click(screen.getByRole('tab', { name: 'Swap' }));
    const swapWarning = screen.getByRole('alert');
    expect(swapWarning).toHaveTextContent('CRITICAL');
    expect(swapWarning).toHaveTextContent(/TWAP-guarded swaps will fail closed/i);
  });

  it('renders low circuit breaker headroom warning with explicit non-color text status', () => {
    render(<SimulationLab fixture={SIMULATION_LAB_FIXTURES.lowBreaker} />);

    const warning = screen.getByRole('alert');
    expect(warning).toHaveAttribute(
      'data-warning-code',
      'BREAKER_LOW_HEADROOM'
    );
    expect(warning).toHaveTextContent('WARNING');
    expect(screen.getByText('LOW HEADROOM')).toBeInTheDocument();
  });
});
