/**
 * Incident war room (Issue #2066).
 *
 * A single, accessible view of the vault's pause state, per-token circuit
 * breaker headroom and pending reservations. Data arrives from the optional
 * GraphQL snapshot endpoint and from the shared RealtimeContext WebSocket;
 * both are optional, so the view degrades to the last known snapshot.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, Radio } from 'lucide-react';
import { useIncidentWarRoom } from '../hooks/useIncidentWarRoom';
import type {
  IncidentAcknowledgement,
  IncidentRealtimeLike,
  IncidentSnapshot,
  IncidentStatus,
} from '../types/incident';
import { EMPTY_INCIDENT_SNAPSHOT } from '../types/incident';
import {
  buildIncidentCsv,
  createAcknowledgement,
  deriveIncidentStatus,
  recoveryProposalHref,
  resolveIncidentGraphqlEndpoint,
  tokenUtilization,
} from '../utils/incidentWarRoom';

const STATUS_CLASSES: Record<IncidentStatus, string> = {
  NORMAL: 'border-emerald-400 bg-emerald-900/70 text-emerald-50',
  TRIPPED: 'border-red-400 bg-red-900/70 text-red-50',
  PAUSED: 'border-amber-300 bg-amber-900/70 text-amber-50',
};

const FOCUS_CLASSES =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-purple-300 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900';

const ConnectionIndicator = ({ label, live }: { label: string; live: boolean }) => (
  <span
    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${
      live
        ? 'border-emerald-400 bg-emerald-950/70 text-emerald-100'
        : 'border-gray-500 bg-gray-800 text-gray-200'
    }`}
  >
    <Radio className="h-3.5 w-3.5" aria-hidden="true" />
    {label}
  </span>
);

const RecoveryLink = ({ proposalId }: { proposalId?: string | null }) => {
  const href = recoveryProposalHref(proposalId);
  if (!href) return <span className="text-gray-300">—</span>;
  return (
    <Link
      to={href}
      className={`rounded text-purple-200 underline decoration-purple-400 underline-offset-2 hover:text-white ${FOCUS_CLASSES}`}
      aria-label={`Open recovery proposal ${proposalId}`}
    >
      #{proposalId}
    </Link>
  );
};

export interface IncidentWarRoomProps {
  /** Controlled snapshot. When omitted the component manages its own copy. */
  snapshot?: IncidentSnapshot;
  /** Seed snapshot for the uncontrolled mode; also useful for demos and tests. */
  initialSnapshot?: IncidentSnapshot;
  /** Pass null to explicitly disable WebSocket integration. */
  realtime?: IncidentRealtimeLike | null;
  onAcknowledge?: (acknowledgement: IncidentAcknowledgement) => void | Promise<void>;
  graphqlUrl?: string;
  contractId?: string;
  actor?: string | null;
  autoFetch?: boolean;
}

export function IncidentWarRoom({
  snapshot,
  initialSnapshot,
  realtime,
  onAcknowledge,
  graphqlUrl,
  contractId,
  actor,
  autoFetch = true,
}: IncidentWarRoomProps) {
  const seed = initialSnapshot ?? snapshot ?? EMPTY_INCIDENT_SNAPSHOT;
  const endpoint = resolveIncidentGraphqlEndpoint(graphqlUrl);
  const resolvedContractId =
    contractId ??
    (import.meta.env as Record<string, string | undefined>).VITE_CONTRACT_ID ??
    '';

  const {
    snapshot: activeSnapshot,
    connection,
    lastEvent,
    error: fetchError,
    sendUpdate,
  } = useIncidentWarRoom({
    initialSnapshot: seed,
    controlledSnapshot: snapshot,
    realtime,
    graphqlUrl: endpoint,
    contractId: resolvedContractId,
    autoFetch,
  });

  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);

  const status = deriveIncidentStatus(activeSnapshot);
  const tokenCount = activeSnapshot.tokens.length;
  const trippedTokens = useMemo(
    () => activeSnapshot.tokens.filter((token) => token.tripped).length,
    [activeSnapshot.tokens],
  );
  const reservationCount = activeSnapshot.reservations.length;
  const incidentKey = `${activeSnapshot.incidentId ?? 'current'}|${status}|${activeSnapshot.updatedAt ?? ''}`;
  const isAcknowledged = acknowledgedKey === incidentKey;

  const connectionLabel =
    connection === 'live'
      ? 'Live updates connected'
      : connection === 'reconnecting'
        ? 'Reconnecting to live updates'
        : 'Live updates unavailable — showing last known data';

  const liveMessage =
    announcement ??
    fetchError ??
    lastEvent?.message ??
    `War room ${connectionLabel.toLowerCase()}.`;

  const handleAcknowledge = useCallback(async () => {
    if (acknowledging || isAcknowledged) return;
    const acknowledgement = createAcknowledgement(activeSnapshot, actor);
    setAcknowledging(true);
    try {
      await onAcknowledge?.(acknowledgement);
      sendUpdate(
        'incident_acknowledged',
        acknowledgement as unknown as Record<string, unknown>,
      );
      setAcknowledgedKey(incidentKey);
      setAnnouncement(
        `Incident acknowledged for ${status.toLowerCase()} state at ${acknowledgement.acknowledgedAt}.`,
      );
    } catch (caught) {
      setAnnouncement(
        `Could not acknowledge incident: ${caught instanceof Error ? caught.message : 'unknown error'}.`,
      );
    } finally {
      setAcknowledging(false);
    }
  }, [
    acknowledging,
    isAcknowledged,
    activeSnapshot,
    actor,
    onAcknowledge,
    sendUpdate,
    incidentKey,
    status,
  ]);

  const handleExport = useCallback(() => {
    try {
      const csv = buildIncidentCsv(activeSnapshot);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `incident-war-room-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
      setAnnouncement(`Exported ${tokenCount + reservationCount} incident rows as CSV.`);
    } catch (caught) {
      setAnnouncement(
        `Could not export CSV: ${caught instanceof Error ? caught.message : 'unknown error'}.`,
      );
    }
  }, [activeSnapshot, tokenCount, reservationCount]);

  return (
    <div className="space-y-6 text-gray-100">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 id="incident-war-room-title" className="text-2xl font-bold text-white sm:text-3xl">
            Incident War Room
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-300">
            Vault pause state, per-token circuit-breaker headroom and reservations still pending execution.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex min-h-[36px] items-center rounded-full border px-3 py-1 text-xs font-bold tracking-wide ${STATUS_CLASSES[status]}`}
          >
            {status}
          </span>
          <ConnectionIndicator label={connectionLabel} live={connection === 'live'} />
          <button
            type="button"
            onClick={handleExport}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-gray-500 bg-gray-800 px-4 py-2 text-sm font-semibold text-gray-100 hover:bg-gray-700 ${FOCUS_CLASSES}`}
            aria-label="Export incident snapshot as CSV"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => void handleAcknowledge()}
            disabled={acknowledging || isAcknowledged}
            aria-label={isAcknowledged ? 'Incident already acknowledged' : 'Acknowledge this incident'}
            className={`inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${FOCUS_CLASSES} ${
              isAcknowledged
                ? 'cursor-default border border-emerald-400 bg-emerald-900/70 text-emerald-100'
                : 'border border-purple-400 bg-purple-700 text-white hover:bg-purple-600 disabled:opacity-60'
            }`}
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            {isAcknowledged ? 'Acknowledged' : 'Acknowledge'}
          </button>
        </div>
      </header>

      {/* Live announcements are visible and announced to assistive technology. */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="rounded-lg border border-gray-600 bg-gray-800/80 px-4 py-3 text-sm text-gray-100"
      >
        <span className="font-semibold text-white">War room: </span>
        {liveMessage}
      </div>

      <section
        aria-labelledby="pause-state-heading"
        className={`rounded-xl border p-4 sm:p-5 ${
          activeSnapshot.pause.paused
            ? 'border-red-400 bg-red-950/70 text-red-50'
            : 'border-emerald-500/60 bg-emerald-950/50 text-emerald-50'
        }`}
      >
        <div className="flex items-start gap-3">
          {activeSnapshot.pause.paused ? (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-300" aria-hidden="true" />
          ) : (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" aria-hidden="true" />
          )}
          <div className="min-w-0 flex-1">
            <h2 id="pause-state-heading" className="text-base font-bold">
              {activeSnapshot.pause.paused ? 'Vault paused' : 'Vault active'}
            </h2>
            <p className="mt-1 text-sm text-gray-200">
              {activeSnapshot.pause.paused
                ? 'Spending is halted. Coordinate recovery through the linked proposals before resuming.'
                : 'No vault pause is recorded. Circuit-breaker state is still shown below.'}
            </p>
            {activeSnapshot.pause.paused && (
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="font-semibold text-red-200">Cause</dt>
                  <dd className="break-words text-gray-100">
                    {activeSnapshot.pause.cause ?? 'Not specified'}
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-red-200">Paused at</dt>
                  <dd className="text-gray-100">{activeSnapshot.pause.pausedAt ?? 'Unknown'}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-red-200">Paused by</dt>
                  <dd className="break-all font-mono text-xs text-gray-100">
                    {activeSnapshot.pause.pausedBy ?? 'Unknown'}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        </div>
      </section>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Overall status', value: status },
          { label: 'Tokens tracked', value: String(tokenCount) },
          { label: 'Tripped breakers', value: String(trippedTokens) },
          { label: 'Pending reservations', value: String(reservationCount) },
        ].map((item) => (
          <div key={item.label} className="rounded-lg border border-gray-600 bg-gray-800/70 p-3">
            <dt className="text-xs font-semibold uppercase tracking-wide text-gray-300">{item.label}</dt>
            <dd className="mt-1 text-xl font-bold text-white">{item.value}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="token-limits-heading" className="rounded-xl border border-gray-700 bg-gray-900/70 p-4 sm:p-5">
        <h2 id="token-limits-heading" className="text-base font-bold text-white">
          Per-token outflow vs circuit-breaker limits
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <caption className="sr-only">
              Current outflow compared with the circuit-breaker limit for each token
            </caption>
            <thead className="border-b border-gray-600 text-xs uppercase tracking-wide text-gray-200">
              <tr>
                <th scope="col" className="px-3 py-2">Token</th>
                <th scope="col" className="px-3 py-2">Outflow</th>
                <th scope="col" className="px-3 py-2">Limit</th>
                <th scope="col" className="px-3 py-2">Utilisation</th>
                <th scope="col" className="px-3 py-2">Breaker state</th>
                <th scope="col" className="px-3 py-2">Recovery proposal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {tokenCount === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-gray-300">
                    No token circuit-breaker data is available.
                  </td>
                </tr>
              ) : (
                activeSnapshot.tokens.map((token, index) => {
                  const utilization = tokenUtilization(token);
                  const percent = Math.round(utilization * 100);
                  const outflow = Number(token.outflow);
                  const limit = Number(token.limit);
                  const meterMax = Math.max(
                    Number.isFinite(outflow) && outflow > 0 ? outflow : 0,
                    Number.isFinite(limit) && limit > 0 ? limit : 0,
                    1,
                  );
                  const tokenKey = `${token.symbol}-${token.address ?? index}`;
                  return (
                    <tr
                      key={tokenKey}
                      className={token.tripped ? 'bg-red-950/40 text-red-50' : 'text-gray-100'}
                    >
                      <th scope="row" className="px-3 py-3 font-semibold">
                        <span>{token.symbol}</span>
                        {token.address && (
                          <span className="mt-0.5 block break-all font-mono text-xs font-normal text-gray-300">
                            {token.address}
                          </span>
                        )}
                      </th>
                      <td className="px-3 py-3 font-mono">{token.outflow}</td>
                      <td className="px-3 py-3 font-mono">{token.limit}</td>
                      <td className="px-3 py-3">
                        <meter
                          min={0}
                          max={meterMax}
                          value={Number.isFinite(outflow) && outflow > 0 ? outflow : 0}
                          aria-label={`${token.symbol} outflow utilisation`}
                          className="h-3 w-24 align-middle"
                        />
                        <span className="ml-2 font-semibold">{percent}%</span>
                      </td>
                      <td className="px-3 py-3">
                        <span
                          className={`rounded-full border px-2 py-1 text-xs font-bold ${
                            token.tripped
                              ? 'border-red-300 bg-red-900/70 text-red-50'
                              : 'border-emerald-400 bg-emerald-900/60 text-emerald-50'
                          }`}
                        >
                          {token.tripped ? 'TRIPPED' : 'NORMAL'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <RecoveryLink proposalId={token.recoveryProposalId ?? activeSnapshot.recoveryProposalId} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="reservations-heading" className="rounded-xl border border-gray-700 bg-gray-900/70 p-4 sm:p-5">
        <h2 id="reservations-heading" className="text-base font-bold text-white">
          Pending reservations
        </h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <caption className="sr-only">Approved proposals whose token amounts are still reserved</caption>
            <thead className="border-b border-gray-600 text-xs uppercase tracking-wide text-gray-200">
              <tr>
                <th scope="col" className="px-3 py-2">Proposal</th>
                <th scope="col" className="px-3 py-2">Token</th>
                <th scope="col" className="px-3 py-2">Reserved amount</th>
                <th scope="col" className="px-3 py-2">Created</th>
                <th scope="col" className="px-3 py-2">Recovery proposal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {reservationCount === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-gray-300">
                    No pending reservations.
                  </td>
                </tr>
              ) : (
                activeSnapshot.reservations.map((reservation) => (
                  <tr key={reservation.proposalId} className="text-gray-100">
                    <th scope="row" className="px-3 py-3 font-mono font-semibold">
                      #{reservation.proposalId}
                    </th>
                    <td className="px-3 py-3">{reservation.tokenSymbol}</td>
                    <td className="px-3 py-3 font-mono">{reservation.amount}</td>
                    <td className="px-3 py-3">{reservation.createdAt ?? 'Unknown'}</td>
                    <td className="px-3 py-3">
                      <RecoveryLink
                        proposalId={reservation.recoveryProposalId ?? reservation.proposalId}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default IncidentWarRoom;
