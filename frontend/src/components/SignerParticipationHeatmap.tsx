import React, { useEffect, useMemo, useState } from 'react';
import { CalendarRange, Flame, UserRound } from 'lucide-react';

const API_BASE = (import.meta.env as Record<string, string | undefined>).VITE_API_BASE_URL ?? '';
const HEATMAP_ENDPOINT = '/api/v1/SignerParticipationScore';

const RANGE_OPTIONS = [30, 90, 180, 365] as const;
const GRID_COLUMNS = 52;
const GRID_ROWS = 7;
const TOTAL_CELLS = GRID_COLUMNS * GRID_ROWS;

export type HeatmapRange = (typeof RANGE_OPTIONS)[number];

export interface ParticipationEntry {
  date: string;
  count: number;
}

export interface SignerParticipationScoreResponse {
  signer: string;
  points: ParticipationEntry[];
}

export type FetchSignerParticipationScore = (
  signer: string,
  rangeDays: HeatmapRange,
) => Promise<SignerParticipationScoreResponse>;

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export const defaultFetchSignerParticipationScore: FetchSignerParticipationScore = async (
  signer,
  rangeDays,
) => {
  const params = new URLSearchParams({ signer, days: String(rangeDays) });
  const response = await fetch(`${API_BASE}${HEATMAP_ENDPOINT}?${params.toString()}`);
  if (!response.ok) {
    throw new Error('Unable to load signer participation score.');
  }
  return (await response.json()) as SignerParticipationScoreResponse;
};

function getColorClass(count: number, maxCount: number): string {
  if (count <= 0 || maxCount <= 0) return 'bg-slate-700/60 border-slate-600/60';
  const ratio = count / maxCount;
  if (ratio <= 0.25) return 'bg-emerald-200 border-emerald-300';
  if (ratio <= 0.5) return 'bg-emerald-400 border-emerald-500';
  if (ratio <= 0.75) return 'bg-emerald-600 border-emerald-700';
  return 'bg-emerald-800 border-emerald-900';
}

function buildCalendarCells(rangeDays: HeatmapRange, values: Map<string, number>) {
  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (TOTAL_CELLS - 1));

  return Array.from({ length: TOTAL_CELLS }, (_, idx) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + idx);
    const iso = toISODate(date);

    const withinRange = idx >= TOTAL_CELLS - rangeDays;
    const count = withinRange ? (values.get(iso) ?? 0) : 0;

    return {
      iso,
      count,
      tooltip: `${count} votes on ${new Date(iso).toLocaleDateString()}`,
    };
  });
}

interface SignerParticipationHeatmapProps {
  signerAddresses: string[];
  fetcher?: FetchSignerParticipationScore;
}

const SignerParticipationHeatmap: React.FC<SignerParticipationHeatmapProps> = ({
  signerAddresses,
  fetcher = defaultFetchSignerParticipationScore,
}) => {
  const [selectedSigner, setSelectedSigner] = useState<string>(signerAddresses[0] ?? '');
  const [rangeDays, setRangeDays] = useState<HeatmapRange>(365);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [points, setPoints] = useState<ParticipationEntry[]>([]);

  useEffect(() => {
    if (!signerAddresses.length) {
      setSelectedSigner('');
      setPoints([]);
      return;
    }

    if (!signerAddresses.includes(selectedSigner)) {
      setSelectedSigner(signerAddresses[0]);
    }
  }, [selectedSigner, signerAddresses]);

  useEffect(() => {
    if (!selectedSigner) return;

    let disposed = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetcher(selectedSigner, rangeDays);
        if (disposed) return;
        setPoints(data.points);
      } catch (err) {
        if (disposed) return;
        setError(err instanceof Error ? err.message : 'Unable to load signer participation score.');
        setPoints([]);
      } finally {
        if (!disposed) setLoading(false);
      }
    };

    void load();

    return () => {
      disposed = true;
    };
  }, [fetcher, rangeDays, selectedSigner]);

  const valueMap = useMemo(() => {
    const map = new Map<string, number>();
    points.forEach((entry) => {
      map.set(entry.date, Math.max(0, entry.count));
    });
    return map;
  }, [points]);

  const cells = useMemo(() => buildCalendarCells(rangeDays, valueMap), [rangeDays, valueMap]);
  const maxCount = useMemo(() => cells.reduce((acc, current) => Math.max(acc, current.count), 0), [cells]);
  const hasNoVotes = useMemo(() => cells.every((cell) => cell.count === 0), [cells]);

  return (
    <section
      className="rounded-xl border border-gray-700 bg-gray-900/40 p-4"
      data-testid="signer-participation-heatmap"
      data-tour="admin-config-evaluation"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h5 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-300">
            <Flame size={15} />
            Signer Participation Heatmap
          </h5>
          <p className="mt-1 text-xs text-gray-400">52-week activity map with vote-density shading.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="relative">
            <span className="sr-only">Choose signer</span>
            <UserRound className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
            <select
              value={selectedSigner}
              onChange={(event) => setSelectedSigner(event.target.value)}
              className="min-h-[38px] rounded-md border border-gray-600 bg-gray-950 py-1.5 pl-7 pr-2 text-xs text-gray-200 contrast-more:border-white"
              data-testid="signer-select"
            >
              {signerAddresses.map((address) => (
                <option value={address} key={address}>
                  {address}
                </option>
              ))}
            </select>
          </label>

          <div className="flex rounded-md border border-gray-600 bg-gray-950 p-0.5 contrast-more:border-white" role="group" aria-label="Date range selector">
            <CalendarRange size={14} className="mx-1 my-auto text-gray-400" />
            {RANGE_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setRangeDays(days)}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  rangeDays === days ? 'bg-emerald-600 text-white' : 'text-gray-300 hover:bg-gray-800'
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {!signerAddresses.length && (
        <p className="rounded-md border border-dashed border-gray-600 px-3 py-6 text-center text-sm text-gray-400">
          No signer addresses available to render participation heatmap.
        </p>
      )}

      {!!signerAddresses.length && (
        <>
          {error && (
            <p className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</p>
          )}

          <div className="overflow-x-auto" data-testid="heatmap-scroll-wrapper">
            <div
              className="grid min-w-[680px] grid-flow-col grid-rows-7 gap-1"
              style={{ gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))` }}
            >
              {cells.map((cell) => (
                <div
                  key={cell.iso}
                  title={cell.tooltip}
                  className={`h-3.5 w-3.5 rounded-sm border ${getColorClass(cell.count, maxCount)}`}
                  aria-label={cell.tooltip}
                  data-testid="heatmap-cell"
                />
              ))}
            </div>
          </div>

          {!loading && hasNoVotes && (
            <p className="mt-3 text-xs text-gray-500">No votes found in the selected range.</p>
          )}
        </>
      )}
    </section>
  );
};

export default SignerParticipationHeatmap;
