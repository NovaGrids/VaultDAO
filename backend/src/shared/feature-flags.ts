import { createLogger } from "./logging/logger.js";

const logger = createLogger("feature-flags");

/**
 * Closed set of feature flags this backend understands. Add new flags here —
 * anything not listed is rejected, so typos cannot create phantom flags.
 */
export const KNOWN_FLAGS = ["sse", "multi_vault", "governance_snapshot"] as const;

export type FlagName = (typeof KNOWN_FLAGS)[number];

const KNOWN_FLAG_SET: ReadonlySet<string> = new Set(KNOWN_FLAGS);

export function isKnownFlag(value: string): value is FlagName {
  return KNOWN_FLAG_SET.has(value);
}

/**
 * FeatureFlagService: in-memory flag store initialized from env.
 * Flags reset on restart — env is the persistent source.
 *
 * Initialize from env: FEATURE_FLAGS=sse:true,multi_vault:false
 * Unknown flag names in the env string are ignored with a warning.
 */
export class FeatureFlagService {
  private readonly flags: Map<FlagName, boolean> = new Map(
    KNOWN_FLAGS.map((flag) => [flag, false]),
  );

  constructor(envValue?: string) {
    if (envValue) {
      for (const entry of envValue.split(",")) {
        const [rawName, val] = entry.trim().split(":");
        const name = rawName?.trim();
        if (!name || val === undefined) continue;
        if (!isKnownFlag(name)) {
          logger.warn("ignoring unknown feature flag from env", { flag: name });
          continue;
        }
        this.flags.set(name, val.trim() === "true");
      }
    }
  }

  public isEnabled(flag: FlagName): boolean {
    return this.flags.get(flag) ?? false;
  }

  public enable(flag: FlagName): void {
    this.flags.set(flag, true);
    logger.info("feature flag enabled", { flag });
  }

  public disable(flag: FlagName): void {
    this.flags.set(flag, false);
    logger.info("feature flag disabled", { flag });
  }

  public list(): Record<FlagName, boolean> {
    return Object.fromEntries(this.flags) as Record<FlagName, boolean>;
  }
}

let _service: FeatureFlagService | null = null;

export function initFeatureFlags(envValue?: string): FeatureFlagService {
  _service = new FeatureFlagService(envValue);
  return _service;
}

export function getFeatureFlags(): FeatureFlagService {
  if (!_service) _service = new FeatureFlagService();
  return _service;
}
