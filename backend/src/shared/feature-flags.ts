import { createLogger } from "./logging/logger.js";

const logger = createLogger("feature-flags");

/** Flag names must be snake_case strings. */
export type FlagName = string;

/**
 * FeatureFlagService: in-memory flag store initialized from env.
 * Flags reset on restart — env is the persistent source.
 *
 * Initialize from env: FEATURE_FLAGS=sse:true,multi_vault:false
 */
export class FeatureFlagService {
  private readonly flags: Map<FlagName, boolean> = new Map();

  constructor(envValue?: string) {
    if (envValue) {
      for (const entry of envValue.split(",")) {
        const [name, val] = entry.trim().split(":");
        if (name && val !== undefined) {
          this.flags.set(name.trim(), val.trim() === "true");
        }
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
    return Object.fromEntries(this.flags);
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
