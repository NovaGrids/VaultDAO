import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cpu,
  FlaskConical,
  Gauge,
  OctagonAlert,
  Play,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import {
  SIMULATION_LAB_FIXTURES,
  computeLimitAndBreakerPreview,
  evaluateSimulationWarnings,
  formatStroopsToXlm,
  runSimulationLabDryRun,
  type ContractStateFixture,
  type SimulationActionType,
  type SimulationLabOutcome,
  type SimulationLabSdkAdapter,
  type SimulationTxParams,
  type VoteChoice,
} from '../utils/simulationLab';

export interface SimulationLabProps {
  /** Initial on-chain contract state fixture (defaults to healthy preset). */
  fixture?: ContractStateFixture;
  /** Optional custom SDK simulate adapter (for live RPC or unit test mocks). */
  sdkAdapter?: SimulationLabSdkAdapter;
  /** Optional initial action tab. */
  initialAction?: SimulationActionType;
}

const ACTION_TABS: Array<{ id: SimulationActionType; label: string }> = [
  { id: 'create', label: 'Create Proposal' },
  { id: 'vote', label: 'Vote' },
  { id: 'execute', label: 'Execute' },
  { id: 'swap', label: 'Swap' },
];

const FIXTURE_PRESETS: Array<{
  key: keyof typeof SIMULATION_LAB_FIXTURES;
  label: string;
}> = [
  { key: 'healthy', label: 'Healthy Vault' },
  { key: 'paused', label: 'Paused Vault' },
  { key: 'staleOracle', label: 'Stale Oracle' },
  { key: 'lowBreaker', label: 'Low Breaker Headroom' },
];

function xlmInputToStroops(value: string): bigint {
  const num = Number.parseFloat(value);
  if (!Number.isFinite(num) || num <= 0) return 0n;
  return BigInt(Math.round(num * 10_000_000));
}

export const SimulationLab: React.FC<SimulationLabProps> = ({
  fixture: externalFixture,
  sdkAdapter,
  initialAction = 'create',
}) => {
  const [presetKey, setPresetKey] =
    useState<keyof typeof SIMULATION_LAB_FIXTURES>('healthy');
  const activeFixture = externalFixture ?? SIMULATION_LAB_FIXTURES[presetKey];

  const [action, setAction] = useState<SimulationActionType>(initialAction);
  const [recipient, setRecipient] = useState(
    'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBP7E'
  );
  const [token, setToken] = useState('XLM');
  const [amountXlm, setAmountXlm] = useState('1000');
  const [memo, setMemo] = useState('Treasury disbursement dry-run');
  const [proposalId, setProposalId] = useState('42');
  const [voteChoice, setVoteChoice] = useState<VoteChoice>('approve');
  const [dex, setDex] = useState('Soroswap');
  const [tokenOut, setTokenOut] = useState('USDC');
  const [minOutXlm, setMinOutXlm] = useState('950');

  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<SimulationLabOutcome | null>(null);

  const currentParams: SimulationTxParams = useMemo(() => {
    const amountStroops = xlmInputToStroops(amountXlm);
    if (action === 'create') {
      return {
        action: 'create',
        recipient,
        token,
        amountStroops,
        memo,
      };
    }
    if (action === 'vote') {
      return {
        action: 'vote',
        proposalId,
        choice: voteChoice,
      };
    }
    if (action === 'execute') {
      return {
        action: 'execute',
        proposalId,
        amountStroops,
      };
    }
    return {
      action: 'swap',
      dex,
      tokenIn: token,
      tokenOut,
      amountInStroops: amountStroops,
      minAmountOutStroops: xlmInputToStroops(minOutXlm),
    };
  }, [
    action,
    recipient,
    token,
    amountXlm,
    memo,
    proposalId,
    voteChoice,
    dex,
    tokenOut,
    minOutXlm,
  ]);

  const livePreview = useMemo(() => {
    const amount =
      currentParams.action === 'vote'
        ? 0n
        : currentParams.action === 'swap'
          ? currentParams.amountInStroops
          : currentParams.amountStroops;
    return computeLimitAndBreakerPreview(activeFixture, amount);
  }, [activeFixture, currentParams]);

  const liveWarnings = useMemo(
    () => evaluateSimulationWarnings(activeFixture, action, livePreview),
    [activeFixture, action, livePreview]
  );

  const displayedPreview = outcome?.preview ?? livePreview;
  const displayedWarnings = outcome?.warnings ?? liveWarnings;

  const handleRunDryRun = async (e: React.FormEvent) => {
    e.preventDefault();
    setRunning(true);
    try {
      const result = await runSimulationLabDryRun(
        currentParams,
        activeFixture,
        sdkAdapter
      );
      setOutcome(result);
    } finally {
      setRunning(false);
    }
  };

  return (
    <section
      aria-labelledby="simulation-lab-heading"
      className="space-y-6 text-slate-100"
    >
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-3">
          <FlaskConical
            className="h-6 w-6 text-purple-400"
            aria-hidden="true"
          />
          <div>
            <h1
              id="simulation-lab-heading"
              className="text-xl font-semibold text-white"
            >
              Governance Simulation Lab
            </h1>
            <p className="text-sm text-slate-400">
              Dry-run create, vote, execute, and swap transactions against
              spending limits, circuit breakers, and Soroban resources before
              signing.
            </p>
          </div>
        </div>

        {!externalFixture && (
          <div className="flex items-center gap-2">
            <label
              htmlFor="sim-fixture-preset"
              className="text-xs font-medium text-slate-300"
            >
              Vault State Fixture
            </label>
            <select
              id="sim-fixture-preset"
              value={presetKey}
              onChange={(e) => {
                setPresetKey(
                  e.target.value as keyof typeof SIMULATION_LAB_FIXTURES
                );
                setOutcome(null);
              }}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-white"
            >
              {FIXTURE_PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Pre-flight & Active Warnings (Accessible — icon + explicit severity label, never color-only) */}
      {displayedWarnings.length > 0 && (
        <div
          role="region"
          aria-label="Simulation warnings"
          className="space-y-2"
        >
          {displayedWarnings.map((w) => {
            const isCritical = w.severity === 'critical';
            return (
              <div
                key={w.code}
                role="alert"
                data-warning-code={w.code}
                className={`flex items-start gap-3 rounded-lg border p-3 text-sm ${
                  isCritical
                    ? 'border-red-500/60 bg-red-950/50 text-red-100'
                    : 'border-amber-500/60 bg-amber-950/50 text-amber-100'
                }`}
              >
                {isCritical ? (
                  <OctagonAlert
                    className="mt-0.5 h-5 w-5 shrink-0 text-red-400"
                    aria-hidden="true"
                  />
                ) : (
                  <AlertTriangle
                    className="mt-0.5 h-5 w-5 shrink-0 text-amber-400"
                    aria-hidden="true"
                  />
                )}
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 font-semibold">
                    <span className="rounded border border-current px-1.5 py-0.5 text-xs uppercase tracking-wide">
                      {isCritical ? 'CRITICAL' : 'WARNING'}
                    </span>
                    <span>{w.title}</span>
                  </div>
                  <p className="text-xs opacity-90">{w.detail}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Main Grid: Form + Preview Panel */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left: Action Form */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-4">
          <div
            role="tablist"
            aria-label="Governance transaction type"
            className="flex flex-wrap gap-2 border-b border-slate-800 pb-3"
          >
            {ACTION_TABS.map((tab) => {
              const selected = action === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => {
                    setAction(tab.id);
                    setOutcome(null);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                    selected
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <form onSubmit={handleRunDryRun} className="space-y-4">
            {action === 'create' && (
              <>
                <div>
                  <label
                    htmlFor="sim-recipient"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Recipient Address
                  </label>
                  <input
                    id="sim-recipient"
                    type="text"
                    value={recipient}
                    onChange={(e) => setRecipient(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="sim-amount"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Amount (XLM)
                    </label>
                    <input
                      id="sim-amount"
                      type="number"
                      min="0"
                      step="any"
                      value={amountXlm}
                      onChange={(e) => setAmountXlm(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sim-token"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Asset
                    </label>
                    <input
                      id="sim-token"
                      type="text"
                      value={token}
                      onChange={(e) => setToken(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="sim-memo"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Memo
                  </label>
                  <input
                    id="sim-memo"
                    type="text"
                    value={memo}
                    onChange={(e) => setMemo(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </>
            )}

            {action === 'vote' && (
              <>
                <div>
                  <label
                    htmlFor="sim-proposal-id"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Proposal ID
                  </label>
                  <input
                    id="sim-proposal-id"
                    type="text"
                    value={proposalId}
                    onChange={(e) => setProposalId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sim-vote-choice"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Vote Choice
                  </label>
                  <select
                    id="sim-vote-choice"
                    value={voteChoice}
                    onChange={(e) =>
                      setVoteChoice(e.target.value as VoteChoice)
                    }
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  >
                    <option value="approve">Approve</option>
                    <option value="reject">Reject</option>
                    <option value="abstain">Abstain</option>
                  </select>
                </div>
              </>
            )}

            {action === 'execute' && (
              <>
                <div>
                  <label
                    htmlFor="sim-exec-proposal-id"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Proposal ID
                  </label>
                  <input
                    id="sim-exec-proposal-id"
                    type="text"
                    value={proposalId}
                    onChange={(e) => setProposalId(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label
                    htmlFor="sim-exec-amount"
                    className="block text-xs font-medium text-slate-300 mb-1"
                  >
                    Proposal Outflow Amount (XLM)
                  </label>
                  <input
                    id="sim-exec-amount"
                    type="number"
                    min="0"
                    step="any"
                    value={amountXlm}
                    onChange={(e) => setAmountXlm(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </>
            )}

            {action === 'swap' && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="sim-dex"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      DEX Router
                    </label>
                    <input
                      id="sim-dex"
                      type="text"
                      value={dex}
                      onChange={(e) => setDex(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sim-token-out"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Token Out
                    </label>
                    <input
                      id="sim-token-out"
                      type="text"
                      value={tokenOut}
                      onChange={(e) => setTokenOut(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="sim-swap-in"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Amount In ({token})
                    </label>
                    <input
                      id="sim-swap-in"
                      type="number"
                      min="0"
                      step="any"
                      value={amountXlm}
                      onChange={(e) => setAmountXlm(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="sim-swap-min-out"
                      className="block text-xs font-medium text-slate-300 mb-1"
                    >
                      Min Amount Out ({tokenOut})
                    </label>
                    <input
                      id="sim-swap-min-out"
                      type="number"
                      min="0"
                      step="any"
                      value={minOutXlm}
                      onChange={(e) => setMinOutXlm(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                    />
                  </div>
                </div>
              </>
            )}

            <button
              type="submit"
              disabled={running}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
            >
              <Play className="h-4 w-4" aria-hidden="true" />
              {running ? 'Running Dry-Run Simulation...' : 'Run Dry-Run Simulation'}
            </button>
          </form>

          {/* Accessible Simulation Outcome Summary */}
          {outcome && (
            <div
              role={outcome.ok ? 'status' : 'alert'}
              aria-live="polite"
              className={`rounded-lg border p-4 text-sm ${
                outcome.ok
                  ? 'border-emerald-500/60 bg-emerald-950/40 text-emerald-100'
                  : 'border-red-500/60 bg-red-950/50 text-red-100'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold">
                {outcome.ok ? (
                  <CheckCircle2
                    className="h-5 w-5 text-emerald-400"
                    aria-hidden="true"
                  />
                ) : (
                  <XCircle
                    className="h-5 w-5 text-red-400"
                    aria-hidden="true"
                  />
                )}
                <span className="rounded border border-current px-1.5 py-0.5 text-xs uppercase">
                  {outcome.ok ? 'PASS' : 'ERROR'}
                </span>
                <span>
                  {outcome.ok
                    ? `Dry-run succeeded for "${outcome.action}"`
                    : `Simulation failed: ${outcome.error?.name} (Error #${outcome.error?.code})`}
                </span>
              </div>

              {outcome.ok && outcome.stateSummary.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                  {outcome.stateSummary.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}

              {!outcome.ok && outcome.error && (
                <div className="mt-2 space-y-1 text-xs">
                  <p>
                    <strong>SDK Error:</strong> {outcome.error.name} (#
                    {outcome.error.code}) — {outcome.error.description}
                  </p>
                  <p>
                    <strong>Remediation:</strong> {outcome.error.remediation}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: Preview Panel (Resources, Limits, Breaker Headroom) */}
        <div className="space-y-4">
          {/* Soroban Resources & Fees */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Cpu className="h-4 w-4 text-purple-400" aria-hidden="true" />
              <h2>Estimated Fees &amp; Soroban Resources</h2>
            </div>

            {outcome?.resources ? (
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div className="rounded-lg bg-slate-950/70 p-3">
                  <dt className="text-slate-400">Estimated Total Fee</dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {formatStroopsToXlm(outcome.resources.estimatedFeeStroops)}{' '}
                    XLM ({outcome.resources.estimatedFeeStroops.toString()}{' '}
                    stroops)
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-950/70 p-3">
                  <dt className="text-slate-400">Resource Fee</dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {outcome.resources.resourceFeeStroops.toString()} stroops
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-950/70 p-3">
                  <dt className="text-slate-400">CPU Instructions</dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {outcome.resources.cpuInstructions.toLocaleString()}
                  </dd>
                </div>
                <div className="rounded-lg bg-slate-950/70 p-3">
                  <dt className="text-slate-400">Memory / Ledger I/O</dt>
                  <dd className="mt-1 text-sm font-semibold text-white">
                    {Math.round(outcome.resources.memoryBytes / 1024)} KB •{' '}
                    {outcome.resources.ledgerReads}R /{' '}
                    {outcome.resources.ledgerWrites}W
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-xs text-slate-400">
                Run a dry-run simulation to estimate Soroban CPU, memory, ledger
                footprint, and resource fee.
              </p>
            )}
          </div>

          {/* Spending Limit Impact */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Gauge className="h-4 w-4 text-purple-400" aria-hidden="true" />
              <h2>Spending Limit Impact</h2>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <span>
                  Per-Proposal Limit (
                  {formatStroopsToXlm(displayedPreview.perProposal.limitStroops)}{' '}
                  XLM)
                </span>
                <span className="font-semibold">
                  {displayedPreview.perProposal.exceeds
                    ? '[EXCEEDS LIMIT]'
                    : '[WITHIN LIMIT]'}
                </span>
              </div>

              {/* Daily Limit */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>
                    Daily Limit:{' '}
                    {formatStroopsToXlm(displayedPreview.daily.usedAfterStroops)}{' '}
                    / {formatStroopsToXlm(displayedPreview.daily.limitStroops)}{' '}
                    XLM ({displayedPreview.daily.utilizationPercent}%)
                  </span>
                  <span className="font-semibold">
                    {displayedPreview.daily.exceeds
                      ? '[EXCEEDS LIMIT]'
                      : `${formatStroopsToXlm(displayedPreview.daily.remainingAfterStroops)} XLM left`}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Daily spending limit utilization"
                  aria-valuenow={displayedPreview.daily.utilizationPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
                >
                  <div
                    className={`h-full ${
                      displayedPreview.daily.exceeds
                        ? 'bg-red-500'
                        : 'bg-purple-500'
                    }`}
                    style={{
                      width: `${Math.min(100, displayedPreview.daily.utilizationPercent)}%`,
                    }}
                  />
                </div>
              </div>

              {/* Weekly Limit */}
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span>
                    Weekly Limit:{' '}
                    {formatStroopsToXlm(
                      displayedPreview.weekly.usedAfterStroops
                    )}{' '}
                    / {formatStroopsToXlm(displayedPreview.weekly.limitStroops)}{' '}
                    XLM ({displayedPreview.weekly.utilizationPercent}%)
                  </span>
                  <span className="font-semibold">
                    {displayedPreview.weekly.exceeds
                      ? '[EXCEEDS LIMIT]'
                      : `${formatStroopsToXlm(displayedPreview.weekly.remainingAfterStroops)} XLM left`}
                  </span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Weekly spending limit utilization"
                  aria-valuenow={displayedPreview.weekly.utilizationPercent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  className="h-2 w-full overflow-hidden rounded-full bg-slate-800"
                >
                  <div
                    className={`h-full ${
                      displayedPreview.weekly.exceeds
                        ? 'bg-red-500'
                        : 'bg-indigo-500'
                    }`}
                    style={{
                      width: `${Math.min(100, displayedPreview.weekly.utilizationPercent)}%`,
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Circuit Breaker Headroom & Spendable Balance */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <ShieldAlert
                  className="h-4 w-4 text-purple-400"
                  aria-hidden="true"
                />
                <h2>Circuit Breaker Headroom</h2>
              </div>
              <span className="rounded border border-slate-600 px-2 py-0.5 text-xs font-semibold">
                {displayedPreview.willTripBreaker
                  ? 'BREAKER TRIPPED'
                  : displayedPreview.breakerHeadroomPercentAfter < 20
                    ? 'LOW HEADROOM'
                    : 'SAFE'}
              </span>
            </div>

            <dl className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-slate-950/70 p-3">
                <dt className="text-slate-400">Spendable Balance</dt>
                <dd className="mt-1 text-sm font-semibold text-white">
                  {formatStroopsToXlm(displayedPreview.spendableStroops)} XLM
                </dd>
              </div>
              <div className="rounded-lg bg-slate-950/70 p-3">
                <dt className="text-slate-400">Remaining Breaker Headroom</dt>
                <dd className="mt-1 text-sm font-semibold text-white">
                  {formatStroopsToXlm(
                    displayedPreview.breakerHeadroomAfterStroops
                  )}{' '}
                  XLM ({displayedPreview.breakerHeadroomPercentAfter}%)
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>
    </section>
  );
};

export default SimulationLab;
