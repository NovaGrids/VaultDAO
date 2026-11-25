/**
 * Pure helpers for the incident war-room view (Issue #2066).
 *
 * Everything here is React-free so the data shaping, CSV export and realtime
 * delta logic can be unit tested in isolation. User-supplied strings are never
 * interpreted as markup: React renders them as text and CSV values go through
 * the shared formula-neutralising serializer.
 */
import { toCsvFromArrays } from './csv';
import type {
  IncidentAcknowledgement,
  IncidentPauseState,
  IncidentSnapshot,
  IncidentStatus,
  PendingReservation,
  TokenCircuitState,
} from '../types/incident';

type UnknownRecord = Record<string, unknown>;

/** Events the war room understands, matching the contract event names where possible. */
export const INCIDENT_REALTIME_EVENTS = [
  'incident_snapshot',
  'vault_paused',
  'vault_unpaused',
  'token_breaker_tripped',
  'token_breaker_reset',
  'reservation_created',
  'reservation_released',
  'incident_acknowledged',
] as const;

export type IncidentRealtimeEvent = (typeof INCIDENT_REALTIME_EVENTS)[number];

/** Query used for the optional initial snapshot fetch over the existing GraphQL transport. */
export const INCIDENT_WAR_ROOM_QUERY = `
  query IncidentWarRoom($contractId: String!) {
    incidentWarRoom(contractId: $contractId) {
      incidentId
      updatedAt
      recoveryProposalId
      pause {
        paused
        cause
        pausedAt
        pausedBy
      }
      tokens {
        symbol
        address
        outflow
        limit
        tripped
        recoveryProposalId
      }
      reservations {
        proposalId
        tokenSymbol
        amount
        createdAt
        recoveryProposalId
      }
    }
  }
`;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = asString(value).trim();
  return text === '' ? null : text;
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function timestamp(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  const text = asString(value).trim();
  if (!text) return null;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? text : date.toISOString();
}

function sameToken(a: TokenCircuitState, candidate: string): boolean {
  const needle = candidate.trim().toLowerCase();
  if (!needle) return false;
  return (
    a.symbol.trim().toLowerCase() === needle ||
    (a.address ?? '').trim().toLowerCase() === needle
  );
}

function normalizeToken(value: unknown): TokenCircuitState {
  const record = asRecord(value) ?? {};
  const rawTripped = record.tripped ?? record.breakerTripped ?? record.isTripped;
  const symbol = asString(
    record.symbol ?? record.tokenSymbol ?? record.token ?? record.tokenAddress,
    'UNKNOWN',
  );
  return {
    symbol,
    address: asNullableString(record.address ?? record.tokenAddress),
    outflow: asString(record.outflow ?? record.outflowAmount ?? record.currentOutflow, '0'),
    limit: asString(
      record.limit ?? record.threshold ?? record.circuitBreakerThreshold ?? record.tokenThreshold,
      '0',
    ),
    tripped: rawTripped === true || rawTripped === 'true',
    windowLabel: asNullableString(record.windowLabel) ?? 'Hourly',
    recoveryProposalId: asNullableString(record.recoveryProposalId ?? record.proposalId),
  };
}

function normalizeReservation(value: unknown): PendingReservation | null {
  const record = asRecord(value);
  if (!record) return null;
  const proposalId = asNullableString(record.proposalId ?? record.id);
  if (!proposalId) return null;
  return {
    proposalId,
    tokenSymbol: asString(record.tokenSymbol ?? record.symbol ?? record.token, 'UNKNOWN'),
    amount: asString(record.amount ?? record.reservedAmount, '0'),
    createdAt: timestamp(record.createdAt ?? record.timestamp),
    recoveryProposalId: asNullableString(record.recoveryProposalId),
  };
}

/** Convert a GraphQL/REST payload into the view model, or null if unusable. */
export function normalizeIncidentSnapshot(raw: unknown): IncidentSnapshot | null {
  const record = asRecord(raw);
  if (!record) return null;

  const hasSnapshotShape =
    'pause' in record ||
    'paused' in record ||
    'tokens' in record ||
    'tokenBreakers' in record ||
    'reservations' in record ||
    'pendingReservations' in record ||
    'updatedAt' in record;
  if (!hasSnapshotShape) return null;

  const pauseRaw = asRecord(record.pause ?? record.pauseState) ?? record;
  const pause: IncidentPauseState = {
    paused: pauseRaw.paused === true || pauseRaw.isPaused === true || pauseRaw.paused === 'true',
    cause: asNullableString(pauseRaw.cause ?? pauseRaw.pauseCause),
    pausedAt: timestamp(pauseRaw.pausedAt ?? pauseRaw.timestamp),
    pausedBy: asNullableString(pauseRaw.pausedBy ?? pauseRaw.actor),
  };

  const tokenValues = record.tokens ?? record.tokenBreakers;
  const reservationValues = record.reservations ?? record.pendingReservations;

  return {
    pause,
    tokens: Array.isArray(tokenValues) ? tokenValues.map(normalizeToken) : [],
    reservations: Array.isArray(reservationValues)
      ? reservationValues.map(normalizeReservation).filter((r): r is PendingReservation => r !== null)
      : [],
    updatedAt: timestamp(record.updatedAt),
    incidentId: asNullableString(record.incidentId),
    recoveryProposalId: asNullableString(record.recoveryProposalId),
  };
}

/** PAUSED outranks TRIPPED, which outranks NORMAL. */
export function deriveIncidentStatus(snapshot: IncidentSnapshot): IncidentStatus {
  if (snapshot.pause.paused) return 'PAUSED';
  const breakerTripped = snapshot.tokens.some((token) => {
    if (token.tripped) return true;
    const limit = numeric(token.limit);
    return limit > 0 && numeric(token.outflow) >= limit;
  });
  return breakerTripped ? 'TRIPPED' : 'NORMAL';
}

/** Ratio of outflow to limit. Values over 1 mean the breaker window is exceeded. */
export function tokenUtilization(token: TokenCircuitState): number {
  const limit = numeric(token.limit);
  if (limit === 0) return 0;
  return numeric(token.outflow) / limit;
}

/**
 * Build a same-app deep link to a recovery proposal.
 * Only digits are accepted: proposal ids are u64, and the allow-list prevents
 * a hostile payload from turning this into a `javascript:` or external URL.
 */
export function recoveryProposalHref(proposalId?: string | null): string | null {
  const id = asNullableString(proposalId);
  if (!id || !/^\d+$/.test(id)) return null;
  return `/dashboard/proposals?search=${encodeURIComponent(id)}`;
}

export function describeIncidentEvent(type: string, payload: unknown): string {
  const record = asRecord(payload) ?? {};
  switch (type) {
    case 'incident_snapshot':
      return 'Incident snapshot refreshed.';
    case 'vault_paused': {
      const cause = asNullableString(record.cause ?? record.pauseCause);
      return cause ? `Vault paused: ${cause}` : 'Vault paused.';
    }
    case 'vault_unpaused':
      return 'Vault unpaused.';
    case 'token_breaker_tripped': {
      const token = asString(record.symbol ?? record.tokenSymbol ?? record.token, 'token');
      return `Circuit breaker tripped for ${token}.`;
    }
    case 'token_breaker_reset': {
      const token = asString(record.symbol ?? record.tokenSymbol ?? record.token, 'token');
      return `Circuit breaker reset for ${token}.`;
    }
    case 'reservation_created': {
      const id = asNullableString(record.proposalId ?? record.id) ?? 'proposal';
      return `Reservation created for proposal #${id}.`;
    }
    case 'reservation_released': {
      const id = asNullableString(record.proposalId ?? record.id) ?? 'proposal';
      return `Reservation released for proposal #${id}.`;
    }
    case 'incident_acknowledged':
      return 'Incident acknowledged.';
    default:
      return 'Incident update received.';
  }
}

/** Merge a realtime event into the current snapshot without mutating it. */
export function applyIncidentEvent(
  snapshot: IncidentSnapshot,
  type: string,
  payload: unknown,
): IncidentSnapshot {
  const record = asRecord(payload) ?? {};
  const updatedAt = timestamp(record.timestamp ?? record.updatedAt) ?? snapshot.updatedAt;

  switch (type) {
    case 'incident_snapshot': {
      const next = normalizeIncidentSnapshot(record.snapshot ?? record);
      return next ?? snapshot;
    }
    case 'vault_paused':
      return {
        ...snapshot,
        pause: {
          ...snapshot.pause,
          paused: true,
          cause: asNullableString(record.cause ?? record.pauseCause) ?? snapshot.pause.cause,
          pausedAt: timestamp(record.pausedAt ?? record.timestamp) ?? snapshot.pause.pausedAt,
          pausedBy: asNullableString(record.pausedBy ?? record.actor) ?? snapshot.pause.pausedBy,
        },
        updatedAt,
      };
    case 'vault_unpaused':
      return {
        ...snapshot,
        pause: { paused: false, cause: null, pausedAt: null, pausedBy: null },
        updatedAt,
      };
    case 'token_breaker_tripped': {
      const symbol = asString(record.symbol ?? record.tokenSymbol ?? record.token ?? record.tokenAddress);
      if (!symbol) return snapshot;
      const outflow = asString(record.outflow ?? record.refusedAmount, '');
      const limit = asString(record.threshold ?? record.limit, '');
      const recoveryProposalId = asNullableString(record.recoveryProposalId ?? record.proposalId);
      let found = false;
      const tokens = snapshot.tokens.map((token) => {
        if (!sameToken(token, symbol)) return token;
        found = true;
        return {
          ...token,
          tripped: true,
          outflow: outflow || token.outflow,
          limit: limit || token.limit,
          recoveryProposalId: recoveryProposalId ?? token.recoveryProposalId,
        };
      });
      if (!found) {
        tokens.push({
          symbol,
          outflow: outflow || '0',
          limit: limit || '0',
          tripped: true,
          windowLabel: 'Hourly',
          recoveryProposalId,
        });
      }
      return { ...snapshot, tokens, updatedAt };
    }
    case 'token_breaker_reset': {
      const symbol = asString(record.symbol ?? record.tokenSymbol ?? record.token ?? record.tokenAddress);
      return {
        ...snapshot,
        tokens: snapshot.tokens.map((token) =>
          sameToken(token, symbol) ? { ...token, tripped: false } : token,
        ),
        updatedAt,
      };
    }
    case 'reservation_created': {
      const reservation = normalizeReservation(record);
      if (!reservation || snapshot.reservations.some((r) => r.proposalId === reservation.proposalId)) {
        return snapshot;
      }
      return { ...snapshot, reservations: [...snapshot.reservations, reservation], updatedAt };
    }
    case 'reservation_released': {
      const proposalId = asNullableString(record.proposalId ?? record.id);
      if (!proposalId) return snapshot;
      return {
        ...snapshot,
        reservations: snapshot.reservations.filter((r) => r.proposalId !== proposalId),
        updatedAt,
      };
    }
    default:
      return snapshot;
  }
}

/**
 * Flatten both tables into one RFC-4180 CSV. All cells are strings so the
 * shared `toCsvFromArrays` helper neutralises `=`, `+`, `-`, `@`, tab and CR
 * prefixes before a spreadsheet can interpret them as formulas.
 */
export function buildIncidentCsv(snapshot: IncidentSnapshot): string {
  const status = deriveIncidentStatus(snapshot);
  const updatedAt = snapshot.updatedAt ?? '';
  const headers = [
    'recordType',
    'token',
    'outflow',
    'limit',
    'utilization',
    'state',
    'proposalId',
    'recoveryProposal',
    'updatedAt',
  ];

  const tokenRows = snapshot.tokens.map((token) => [
    'token',
    token.symbol,
    token.outflow,
    token.limit,
    `${Math.round(tokenUtilization(token) * 100)}%`,
    token.tripped ? 'TRIPPED' : 'NORMAL',
    '',
    recoveryProposalHref(token.recoveryProposalId) ?? '',
    updatedAt,
  ]);

  const reservationRows = snapshot.reservations.map((reservation) => [
    'reservation',
    reservation.tokenSymbol,
    reservation.amount,
    '',
    '',
    'PENDING',
    reservation.proposalId,
    recoveryProposalHref(reservation.recoveryProposalId ?? reservation.proposalId) ?? '',
    updatedAt,
  ]);

  return toCsvFromArrays([headers, ...tokenRows, ...reservationRows], '\r\n');
}

/** Resolve the GraphQL endpoint from an explicit prop or existing env vars. */
export function resolveIncidentGraphqlEndpoint(explicit?: string): string | undefined {
  if (explicit) return explicit;
  const environment = import.meta.env as Record<string, string | undefined>;
  if (environment.VITE_GRAPHQL_URL) return environment.VITE_GRAPHQL_URL;
  const base = environment.VITE_API_BASE_URL;
  return base ? `${base.replace(/\/$/, '')}/graphql` : undefined;
}

export interface FetchIncidentOptions {
  contractId?: string;
  signal?: AbortSignal;
}

/** Fetch the initial snapshot over the same GraphQL transport used elsewhere in the app. */
export async function fetchIncidentSnapshot(
  endpoint: string,
  options: FetchIncidentOptions = {},
): Promise<IncidentSnapshot> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      query: INCIDENT_WAR_ROOM_QUERY,
      variables: { contractId: options.contractId ?? '' },
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new Error(`Incident snapshot request failed (${response.status})`);
  }

  const body = (await response.json()) as {
    data?: UnknownRecord;
    errors?: Array<{ message?: string }>;
  };
  if (body.errors?.length) {
    throw new Error(body.errors[0]?.message ?? 'Incident snapshot query failed');
  }

  const raw = body.data?.incidentWarRoom ?? body.data?.vault ?? body.data?.incident;
  const snapshot = normalizeIncidentSnapshot(raw);
  if (!snapshot) {
    throw new Error('Incident snapshot response was missing required fields');
  }
  return snapshot;
}

/** Build the payload emitted when an operator acknowledges an incident. */
export function createAcknowledgement(
  snapshot: IncidentSnapshot,
  actor?: string | null,
): IncidentAcknowledgement {
  return {
    incidentId: snapshot.incidentId ?? 'current',
    status: deriveIncidentStatus(snapshot),
    tokenSymbols: snapshot.tokens.filter((t) => t.tripped).map((t) => t.symbol),
    acknowledgedAt: new Date().toISOString(),
    actor: actor ?? null,
  };
}
