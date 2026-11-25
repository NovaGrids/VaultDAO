import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncidentSnapshot } from '../../types/incident';
import {
  applyIncidentEvent,
  buildIncidentCsv,
  deriveIncidentStatus,
  fetchIncidentSnapshot,
  normalizeIncidentSnapshot,
  recoveryProposalHref,
} from '../incidentWarRoom';

const baseSnapshot = (overrides: Partial<IncidentSnapshot> = {}): IncidentSnapshot => ({
  pause: { paused: false },
  tokens: [
    {
      symbol: 'XLM',
      outflow: '100',
      limit: '1000',
      tripped: false,
      recoveryProposalId: '11',
    },
  ],
  reservations: [
    {
      proposalId: '7',
      tokenSymbol: 'XLM',
      amount: '50',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  updatedAt: '2026-01-01T00:00:00.000Z',
  incidentId: 'incident-1',
  ...overrides,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('incident war-room helpers', () => {
  describe('deriveIncidentStatus', () => {
    it('reports NORMAL when the vault is active and all breakers are under their limits', () => {
      expect(deriveIncidentStatus(baseSnapshot())).toBe('NORMAL');
    });

    it('reports TRIPPED when a breaker flag is set or outflow reaches the limit', () => {
      expect(
        deriveIncidentStatus(
          baseSnapshot({
            tokens: [{ symbol: 'USDC', outflow: '5', limit: '100', tripped: true }],
          }),
        ),
      ).toBe('TRIPPED');
      expect(
        deriveIncidentStatus(
          baseSnapshot({
            tokens: [{ symbol: 'USDC', outflow: '100', limit: '100' }],
          }),
        ),
      ).toBe('TRIPPED');
    });

    it('reports PAUSED even when a breaker is also tripped', () => {
      expect(
        deriveIncidentStatus(
          baseSnapshot({
            pause: { paused: true, cause: 'circuit_breaker' },
            tokens: [{ symbol: 'USDC', outflow: '5', limit: '100', tripped: true }],
          }),
        ),
      ).toBe('PAUSED');
    });
  });

  describe('recovery links', () => {
    it('builds a same-app deep link for numeric proposal ids', () => {
      expect(recoveryProposalHref('42')).toBe('/dashboard/proposals?search=42');
    });

    it('rejects unsafe proposal ids', () => {
      expect(recoveryProposalHref('javascript:alert(1)')).toBeNull();
      expect(recoveryProposalHref('<img src=x>')).toBeNull();
      expect(recoveryProposalHref(null)).toBeNull();
    });
  });

  describe('buildIncidentCsv', () => {
    it('neutralises spreadsheet formulas from untrusted token strings', () => {
      const csv = buildIncidentCsv(
        baseSnapshot({
          tokens: [
            {
              symbol: '=cmd|calc',
              outflow: '10',
              limit: '100',
              recoveryProposalId: '3',
            },
          ],
        }),
      );

      // The shared csv helper prefixes formula triggers with a single quote.
      expect(csv).toContain("'=cmd|calc");
      expect(csv).toContain('recordType,token,outflow,limit,utilization,state');
      expect(csv).toContain('reservation,XLM,50');
    });
  });

  describe('applyIncidentEvent', () => {
    it('applies pause, trip and reservation events immutably', () => {
      const initial = baseSnapshot();
      const paused = applyIncidentEvent(initial, 'vault_paused', {
        cause: 'circuit_breaker',
        pausedBy: 'GADMIN',
        timestamp: 1767225600000,
      });
      expect(paused.pause.paused).toBe(true);
      expect(paused.pause.cause).toBe('circuit_breaker');
      expect(initial.pause.paused).toBe(false);

      const tripped = applyIncidentEvent(paused, 'token_breaker_tripped', {
        symbol: 'XLM',
        outflow: '1100',
        threshold: '1000',
        proposalId: '99',
      });
      expect(tripped.tokens[0].tripped).toBe(true);
      expect(tripped.tokens[0].limit).toBe('1000');

      const withReservation = applyIncidentEvent(tripped, 'reservation_created', {
        proposalId: '12',
        tokenSymbol: 'XLM',
        amount: '75',
      });
      expect(withReservation.reservations).toHaveLength(2);

      const released = applyIncidentEvent(withReservation, 'reservation_released', {
        proposalId: '7',
      });
      expect(released.reservations.map((r) => r.proposalId)).toEqual(['12']);

      const reset = applyIncidentEvent(released, 'token_breaker_reset', { symbol: 'XLM' });
      expect(reset.tokens[0].tripped).toBe(false);
    });

    it('accepts a full incident_snapshot event', () => {
      const next = applyIncidentEvent(baseSnapshot(), 'incident_snapshot', {
        snapshot: {
          pause: { paused: true, cause: 'manual' },
          tokens: [],
          reservations: [],
        },
      });
      expect(next.pause).toMatchObject({ paused: true, cause: 'manual' });
      expect(next.tokens).toHaveLength(0);
    });
  });

  describe('GraphQL snapshot', () => {
    it('normalises an incidentWarRoom payload', () => {
      const result = normalizeIncidentSnapshot({
        incidentWarRoom: undefined,
        paused: true,
        pauseCause: 'circuit_breaker',
        tokens: [{ token: 'XLM', currentOutflow: '25', threshold: '100', breakerTripped: true }],
        pendingReservations: [{ id: '4', token: 'XLM', reservedAmount: '9' }],
      });

      expect(result).toMatchObject({
        pause: { paused: true, cause: 'circuit_breaker' },
        tokens: [{ symbol: 'XLM', outflow: '25', limit: '100', tripped: true }],
        reservations: [{ proposalId: '4', amount: '9' }],
      });
    });

    it('posts the query and returns a usable snapshot', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            incidentWarRoom: {
              pause: { paused: false },
              tokens: [],
              reservations: [],
              updatedAt: '2026-01-01T00:00:00Z',
            },
          },
        }),
      });
      vi.stubGlobal('fetch', fetchMock);

      const snapshot = await fetchIncidentSnapshot('https://example.test/graphql', {
        contractId: 'CTEST',
      });

      expect(fetchMock).toHaveBeenCalledOnce();
      const request = fetchMock.mock.calls[0][1] as { body: string };
      expect(request.body).toContain('IncidentWarRoom');
      expect(request.body).toContain('CTEST');
      expect(snapshot.pause.paused).toBe(false);
    });
  });
});
