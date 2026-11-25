import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import IncidentWarRoom from '../IncidentWarRoom';
import type { IncidentRealtimeLike, IncidentSnapshot } from '../../types/incident';

const normalSnapshot = (overrides: Partial<IncidentSnapshot> = {}): IncidentSnapshot => ({
  pause: { paused: false },
  tokens: [
    {
      symbol: 'XLM',
      outflow: '100',
      limit: '1000',
      tripped: false,
    },
  ],
  reservations: [],
  updatedAt: '2026-01-01T00:00:00.000Z',
  incidentId: 'incident-1',
  ...overrides,
});

interface RealtimeHarness {
  realtime: IncidentRealtimeLike;
  handlers: Map<string, (payload: unknown) => void>;
  unsubscribe: ReturnType<typeof vi.fn>;
  sendUpdate: ReturnType<typeof vi.fn>;
}

function makeRealtimeHarness(): RealtimeHarness {
  const handlers = new Map<string, (payload: unknown) => void>();
  const unsubscribe = vi.fn();
  const sendUpdate = vi.fn();
  const realtime = {
    isConnected: true,
    connectionStatus: 'connected',
    sendUpdate,
    subscribe: vi.fn((type: string, handler: (data: unknown) => void) => {
      handlers.set(type, handler);
      return unsubscribe;
    }),
  } as unknown as IncidentRealtimeLike;
  return { realtime, handlers, unsubscribe, sendUpdate };
}

function emit(handlers: RealtimeHarness['handlers'], type: string, payload: unknown) {
  act(() => {
    handlers.get(type)?.(payload);
  });
}

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('IncidentWarRoom - Issue #2066', () => {
  let clickSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn(() => 'blob:incident'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    clickSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('renders the NORMAL state with accessible tables and controls', () => {
    render(
      <IncidentWarRoom
        initialSnapshot={normalSnapshot()}
        realtime={null}
        autoFetch={false}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Incident War Room' })).toBeInTheDocument();
    expect(screen.getByText('Vault active')).toBeInTheDocument();
    expect(screen.getAllByText('NORMAL').length).toBeGreaterThan(0);
    expect(screen.getByRole('table', { name: /current outflow compared/i })).toBeInTheDocument();
    expect(screen.getByText('No pending reservations.')).toBeInTheDocument();

    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveTextContent(/live updates unavailable/i);

    const acknowledge = screen.getByRole('button', { name: /acknowledge this incident/i });
    expect(acknowledge.tagName).toBe('BUTTON');
    expect(acknowledge.className).toContain('focus-visible:ring-2');
  });

  it('renders the TRIPPED state with a recovery deep link', () => {
    const snapshot = normalSnapshot({
      tokens: [
        {
          symbol: 'USDC',
          outflow: '1200',
          limit: '1000',
          tripped: true,
          recoveryProposalId: '77',
        },
      ],
    });

    render(<IncidentWarRoom initialSnapshot={snapshot} realtime={null} autoFetch={false} />);

    expect(screen.getAllByText('TRIPPED').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent(/showing last known data/i);
    // The shared test setup stubs Link and drops aria-label, so query by the
    // visible proposal id here; the component still supplies the label in app.
    const link = screen.getByRole('link', { name: '#77' });
    expect(link).toHaveAttribute('href', '/dashboard/proposals?search=77');
    expect(screen.getByText('USDC')).toBeInTheDocument();
  });

  it('renders the PAUSED state with pause metadata', () => {
    const snapshot = normalSnapshot({
      pause: {
        paused: true,
        cause: 'circuit_breaker',
        pausedAt: '2026-01-01T00:00:00.000Z',
        pausedBy: 'GADMIN',
      },
    });

    render(<IncidentWarRoom initialSnapshot={snapshot} realtime={null} autoFetch={false} />);

    expect(screen.getAllByText('PAUSED').length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Vault paused' })).toBeInTheDocument();
    expect(screen.getByText('circuit_breaker')).toBeInTheDocument();
    expect(screen.getByText('GADMIN')).toBeInTheDocument();
  });

  it('acknowledges an incident, emits the realtime update and announces it', async () => {
    const onAcknowledge = vi.fn().mockResolvedValue(undefined);
    const harness = makeRealtimeHarness();
    const snapshot = normalSnapshot({
      tokens: [{ symbol: 'USDC', outflow: '1200', limit: '1000', tripped: true }],
    });

    render(
      <IncidentWarRoom
        initialSnapshot={snapshot}
        realtime={harness.realtime}
        autoFetch={false}
        onAcknowledge={onAcknowledge}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /acknowledge this incident/i }));

    await waitFor(() => {
      expect(onAcknowledge).toHaveBeenCalledWith(
        expect.objectContaining({ incidentId: 'incident-1', status: 'TRIPPED' }),
      );
    });
    expect(harness.sendUpdate).toHaveBeenCalledWith(
      'incident_acknowledged',
      expect.objectContaining({ status: 'TRIPPED' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent(/incident acknowledged/i);
    expect(screen.getByRole('button', { name: /incident already acknowledged/i })).toBeDisabled();
  });

  it('applies realtime events and unsubscribes every listener on unmount', () => {
    const harness = makeRealtimeHarness();
    const { unmount } = render(
      <IncidentWarRoom
        initialSnapshot={normalSnapshot()}
        realtime={harness.realtime}
        autoFetch={false}
      />,
    );

    expect(harness.realtime.subscribe).toHaveBeenCalled();
    emit(harness.handlers, 'token_breaker_tripped', {
      symbol: 'USDC',
      outflow: '1200',
      threshold: '1000',
      proposalId: '88',
    });

    expect(screen.getAllByText('TRIPPED').length).toBeGreaterThan(0);
    expect(screen.getByRole('status')).toHaveTextContent(/circuit breaker tripped for USDC/i);

    emit(harness.handlers, 'vault_unpaused', {});
    expect(screen.getByText('Vault active')).toBeInTheDocument();

    const subscriptionCount = (harness.realtime.subscribe as ReturnType<typeof vi.fn>).mock.calls.length;
    unmount();
    expect(harness.unsubscribe).toHaveBeenCalledTimes(subscriptionCount);
  });

  it('handles a disconnected realtime context without crashing', () => {
    const realtime = {
      isConnected: false,
      connectionStatus: 'disconnected',
      subscribe: vi.fn(() => vi.fn()),
    } as unknown as IncidentRealtimeLike;

    render(
      <IncidentWarRoom
        initialSnapshot={normalSnapshot()}
        realtime={realtime}
        autoFetch={false}
      />,
    );

    expect(screen.getAllByText(/live updates unavailable/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Vault active')).toBeInTheDocument();
  });

  it('exports a formula-safe CSV', async () => {
    render(
      <IncidentWarRoom
        initialSnapshot={normalSnapshot({
          tokens: [
            {
              symbol: '=cmd|calc',
              outflow: '10',
              limit: '100',
            },
          ],
          reservations: [{ proposalId: '7', tokenSymbol: 'XLM', amount: '50' }],
        })}
        realtime={null}
        autoFetch={false}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /export incident snapshot as csv/i }));

    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    expect(createObjectURL).toHaveBeenCalled();
    const csv = await readBlob(createObjectURL.mock.calls[0][0] as Blob);
    expect(csv).toContain("'=cmd|calc");
    expect(csv).toContain('reservation,XLM,50');
    expect(screen.getByRole('status')).toHaveTextContent(/exported 2 incident rows as csv/i);
  });

  it('never renders untrusted strings as HTML', () => {
    const payload = '<img src=x onerror="window.__incidentXss=1">';
    const { container } = render(
      <IncidentWarRoom
        initialSnapshot={normalSnapshot({
          tokens: [{ symbol: payload, outflow: '1', limit: '10' }],
          pause: { paused: true, cause: payload },
        })}
        realtime={null}
        autoFetch={false}
      />,
    );

    expect(screen.getAllByText(payload).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect((window as unknown as Record<string, unknown>).__incidentXss).toBeUndefined();
  });
});
