export interface CorsValidationResult {
  readonly ok: boolean;
  readonly normalized?: string;
  readonly reason?: string;
}

function buildInvalidResult(reason: string): CorsValidationResult {
  return { ok: false, reason };
}

export function validateCorsOrigin(
  value: string,
  nodeEnv: string,
): CorsValidationResult {
  if (value === "*") {
    return { ok: true, normalized: "*" };
  }

  try {
    const parsed = new URL(value);

    if (value.endsWith("/")) {
      return buildInvalidResult("origin must not include a trailing slash");
    }

    if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return buildInvalidResult("origin must not include path, query, or hash");
    }

    if (parsed.protocol === "https:") {
      return { ok: true, normalized: value };
    }

    if (parsed.protocol === "http:" && nodeEnv !== "production") {
      return { ok: true, normalized: value };
    }

    if (parsed.protocol === "http:" && nodeEnv === "production") {
      return buildInvalidResult("http:// origins are not allowed in production");
    }

    return buildInvalidResult("origin must use https:// (or http:// outside production)");
  } catch {
    return buildInvalidResult("origin must be a valid URL or \"*\"");
  }
}

export class CorsAllowlist {
  private readonly origins: string[];

  constructor(
    private readonly nodeEnv: string,
    initialOrigins: string[] | undefined,
  ) {
    this.origins = Array.isArray(initialOrigins) ? [...initialOrigins] : [];
  }

  public list(): string[] {
    return [...this.origins];
  }

  public hasWildcard(): boolean {
    return this.origins.includes("*");
  }

  public isAllowed(origin: string | undefined): boolean {
    if (!origin) {
      return false;
    }

    return this.hasWildcard() || this.origins.includes(origin);
  }

  public add(origin: string): { changed: boolean; reason?: string } {
    const validation = validateCorsOrigin(origin, this.nodeEnv);
    if (!validation.ok || !validation.normalized) {
      return { changed: false, reason: validation.reason };
    }

    const normalized = validation.normalized;

    if (normalized === "*" && this.origins.length > 0 && !this.hasWildcard()) {
      return {
        changed: false,
        reason: 'wildcard "*" cannot be combined with specific origins',
      };
    }

    if (normalized !== "*" && this.hasWildcard()) {
      return {
        changed: false,
        reason: 'wildcard "*" cannot be combined with specific origins',
      };
    }

    if (this.origins.includes(normalized)) {
      return { changed: false };
    }

    this.origins.push(normalized);
    return { changed: true };
  }

  public remove(origin: string): boolean {
    const index = this.origins.indexOf(origin);
    if (index < 0) {
      return false;
    }

    this.origins.splice(index, 1);
    return true;
  }
}
