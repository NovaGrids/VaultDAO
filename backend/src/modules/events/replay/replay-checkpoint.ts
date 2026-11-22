/**
 * Replay checkpoints and resume tokens.
 *
 * A checkpoint records the last ledger whose events have been fully applied
 * to every projection for one replay run (`contractId` + requested range).
 * It is written next to the cursor adapter's `.event-cursor.json` so the
 * operator only has to back up / inspect one directory.
 *
 * The resume token is an opaque, URL-safe encoding of the checkpoint that an
 * operator can paste into `--resume-token` to continue a run on another host
 * (or after the checkpoint file was lost).
 */

import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createLogger } from "../../../shared/logging/logger.js";

const logger = createLogger("replay-checkpoint");

/** Version of the checkpoint / resume-token payload format. */
export const REPLAY_CHECKPOINT_VERSION = 1;

/** Name of the checkpoint file stored alongside `.event-cursor.json`. */
export const REPLAY_CHECKPOINT_FILE = ".replay-checkpoint.json";

export interface ReplayCheckpoint {
  readonly version: number;
  readonly replayId: string;
  readonly contractId: string;
  /** First ledger of the requested range (inclusive). */
  readonly fromLedger: number;
  /** Last ledger of the requested range (inclusive). */
  readonly toLedger: number;
  /** Every event in `[fromLedger, lastCheckpointLedger]` has been applied. */
  readonly lastCheckpointLedger: number;
  /** Id of the last event applied before the checkpoint, if any. */
  readonly lastEventId?: string;
  /** Number of events applied so far across all resumed segments. */
  readonly eventsApplied: number;
  /** Set once the whole range has been replayed. */
  readonly completed: boolean;
  readonly updatedAt: string;
}

export interface ReplayCheckpointStore {
  load(): Promise<ReplayCheckpoint | null>;
  save(checkpoint: ReplayCheckpoint): Promise<void>;
  clear(): Promise<void>;
}

// ── Resume tokens ───────────────────────────────────────────────────────────

/** Encodes a checkpoint as an opaque, URL-safe resume token. */
export function encodeResumeToken(checkpoint: ReplayCheckpoint): string {
  return Buffer.from(JSON.stringify(checkpoint), "utf8").toString("base64url");
}

/**
 * Decodes a resume token produced by {@link encodeResumeToken}.
 * Throws a descriptive error when the token is malformed.
 */
export function decodeResumeToken(token: string): ReplayCheckpoint {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid resume token: not a valid encoded checkpoint.");
  }
  if (!isReplayCheckpoint(parsed)) {
    throw new Error("Invalid resume token: missing or malformed checkpoint fields.");
  }
  if (parsed.version !== REPLAY_CHECKPOINT_VERSION) {
    throw new Error(
      `Unsupported resume token version ${parsed.version} (expected ${REPLAY_CHECKPOINT_VERSION}).`,
    );
  }
  return parsed;
}

function isReplayCheckpoint(value: unknown): value is ReplayCheckpoint {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["version"] === "number" &&
    typeof v["replayId"] === "string" &&
    typeof v["contractId"] === "string" &&
    Number.isInteger(v["fromLedger"]) &&
    Number.isInteger(v["toLedger"]) &&
    Number.isInteger(v["lastCheckpointLedger"]) &&
    typeof v["eventsApplied"] === "number" &&
    typeof v["completed"] === "boolean" &&
    typeof v["updatedAt"] === "string"
  );
}

/**
 * Returns the ledger a replay should start from given a prior checkpoint, or
 * `null` when the checkpoint does not apply to the requested run (different
 * contract, already completed, starts after the requested start, or its
 * next ledger falls outside the requested range).
 */
export function resolveResumeLedger(
  checkpoint: ReplayCheckpoint | null,
  contractId: string,
  fromLedger: number,
  toLedger: number,
): number | null {
  if (!checkpoint) return null;
  if (checkpoint.completed) return null;
  if (checkpoint.contractId !== contractId) return null;
  // The checkpoint only proves `[checkpoint.fromLedger, lastCheckpointLedger]`
  // was applied, so it can only be used when that span starts at or before
  // the requested start — otherwise ledgers before it would be skipped.
  if (checkpoint.fromLedger > fromLedger) return null;
  const next = checkpoint.lastCheckpointLedger + 1;
  if (next <= fromLedger || next > toLedger) return null;
  return next;
}

// ── Stores ──────────────────────────────────────────────────────────────────

/**
 * File-backed checkpoint store. Lives in the same directory as the
 * {@link FileCursorAdapter}'s `.event-cursor.json` and uses the same
 * write-to-temp-then-rename pattern so a crash never leaves a torn file.
 */
export class FileReplayCheckpointStore implements ReplayCheckpointStore {
  private readonly filePath: string;

  constructor(baseDir: string = "./") {
    this.filePath = join(baseDir, REPLAY_CHECKPOINT_FILE);
  }

  public get path(): string {
    return this.filePath;
  }

  public async load(): Promise<ReplayCheckpoint | null> {
    if (!existsSync(this.filePath)) return null;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8"));
      return isReplayCheckpoint(parsed) ? parsed : null;
    } catch (error) {
      logger.warn("ignoring unreadable replay checkpoint", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  public async save(checkpoint: ReplayCheckpoint): Promise<void> {
    const tempPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tempPath, JSON.stringify(checkpoint, null, 2), "utf8");
      renameSync(tempPath, this.filePath);
    } catch (error) {
      rmSync(tempPath, { force: true });
      throw error;
    }
  }

  public async clear(): Promise<void> {
    rmSync(this.filePath, { force: true });
  }
}

/** In-memory checkpoint store for tests and dry runs. */
export class MemoryReplayCheckpointStore implements ReplayCheckpointStore {
  private checkpoint: ReplayCheckpoint | null = null;
  public saves = 0;

  public async load(): Promise<ReplayCheckpoint | null> {
    return this.checkpoint;
  }

  public async save(checkpoint: ReplayCheckpoint): Promise<void> {
    this.checkpoint = checkpoint;
    this.saves += 1;
  }

  public async clear(): Promise<void> {
    this.checkpoint = null;
  }
}
