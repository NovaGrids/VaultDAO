/**
 * EventReplayCLI
 *
 * Command-line interface for the event replay and backfill command.
 * Provides a user-friendly way to configure and execute replay operations.
 */

import type { ReplayOptions, ReplayOutputFormat } from "./replay.types.js";
import { EventReplayService } from "./replay.service.js";
import { loadEnv } from "../../../config/env.js";
import { fileURLToPath } from "node:url";
import {
  createMemoryPersistence,
  ProposalActivityConsumer,
} from "../../proposals/index.js";
import {
  SnapshotService,
  MemorySnapshotAdapter,
} from "../../snapshots/index.js";
import { existsSync } from "node:fs";
import {
  InMemoryStorageAdapter,
  type StorageAdapter,
} from "../../../shared/storage/storage.adapter.js";
import { SqliteStorageAdapter } from "../../../shared/storage/sqlite.storage.adapter.js";
import {
  ReplayProjectionWriter,
  type ProjectionWrite,
  type ProposalProjection,
  type RecurringProjection,
} from "./replay-projections.js";
import {
  buildReconciliationReport,
  computeProgress,
  formatReconciliationReport,
} from "./replay-report.js";

/** SQLite tables holding the replay projections. */
export const REPLAY_PROPOSAL_PROJECTION_TABLE = "replay_proposal_projections";
export const REPLAY_RECURRING_PROJECTION_TABLE = "replay_recurring_projections";

/**
 * Parses command line arguments into ReplayOptions.
 */
export function parseReplayArgs(args: string[]): ReplayOptions {
  const options = {
    startLedger: 0,
    batchSize: 200,
    dryRun: false,
    verbose: false,
    clear: false,
    endLedger: undefined as number | undefined,
    contractId: undefined as string | undefined,
    rpcUrl: undefined as string | undefined,
    outputDir: undefined as string | undefined,
    eventTypes: undefined as string[] | undefined,
    outputFormat: undefined as ReplayOutputFormat | undefined,
    checkpointEvery: undefined as number | undefined,
    resume: true,
    resumeToken: undefined as string | undefined,
    projectionDbPath: undefined as string | undefined,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case "--from-ledger":
      case "-f":
      case "--start":
      case "-s":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          const ledger = parseInt(nextArg, 10);
          if (isNaN(ledger) || ledger < 0) {
            throw new Error(
              `Invalid start ledger: ${nextArg}. Must be a non-negative integer.`,
            );
          }
          options.startLedger = ledger;
          i++;
        } else {
          throw new Error(`--from-ledger requires a ledger number argument.`);
        }
        break;

      case "--to-ledger":
      case "-t":
      case "--end":
      case "-e":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          const ledger = parseInt(nextArg, 10);
          if (isNaN(ledger) || ledger < 0) {
            throw new Error(
              `Invalid end ledger: ${nextArg}. Must be a non-negative integer.`,
            );
          }
          options.endLedger = ledger;
          i++;
        } else {
          throw new Error(`--to-ledger requires a ledger number argument.`);
        }
        break;

      case "--batch-size":
      case "-b":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          const size = parseInt(nextArg, 10);
          if (isNaN(size) || size < 1 || size > 10000) {
            throw new Error(
              `Invalid batch size: ${nextArg}. Must be between 1 and 10000.`,
            );
          }
          options.batchSize = size;
          i++;
        } else {
          throw new Error(`--batch-size requires a number argument.`);
        }
        break;

      case "--contract-id":
      case "--contract":
      case "-c":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          options.contractId = nextArg;
          i++;
        } else {
          throw new Error(`--contract-id requires a contract ID argument.`);
        }
        break;

      case "--rpc":
      case "-r":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          options.rpcUrl = nextArg;
          i++;
        } else {
          throw new Error(`--rpc requires a URL argument.`);
        }
        break;

      case "--output":
      case "-o":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          options.outputDir = nextArg;
          i++;
        } else {
          throw new Error(`--output requires a directory path argument.`);
        }
        break;

      case "--dry-run":
      case "-d":
        options.dryRun = true;
        break;

      case "--clear":
      case "-w":
        options.clear = true;
        break;

      case "--type":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          const types = nextArg.split(",").map((t) => t.trim().toUpperCase()).filter(Boolean);
          if (types.length === 0) {
            throw new Error(`--type requires at least one event type.`);
          }
          options.eventTypes = types;
          i++;
        } else {
          throw new Error(`--type requires a comma-separated list of event types.`);
        }
        break;

      case "--format":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          if (nextArg !== "json" && nextArg !== "human") {
            throw new Error(`Invalid format: ${nextArg}. Must be 'json' or 'human'.`);
          }
          options.outputFormat = nextArg as ReplayOutputFormat;
          i++;
        } else {
          throw new Error(`--format requires 'json' or 'human'.`);
        }
        break;

      case "--checkpoint-every":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          const every = parseInt(nextArg, 10);
          if (isNaN(every) || every < 1) {
            throw new Error(
              `Invalid checkpoint interval: ${nextArg}. Must be a positive integer number of ledgers.`,
            );
          }
          options.checkpointEvery = every;
          i++;
        } else {
          throw new Error(`--checkpoint-every requires a ledger count argument.`);
        }
        break;

      case "--resume-token":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          options.resumeToken = nextArg;
          i++;
        } else {
          throw new Error(`--resume-token requires a token argument.`);
        }
        break;

      case "--no-resume":
        options.resume = false;
        break;

      case "--projection-db":
        if (nextArg !== undefined && !nextArg.startsWith("-")) {
          options.projectionDbPath = nextArg;
          i++;
        } else {
          throw new Error(`--projection-db requires a SQLite file path argument.`);
        }
        break;

      case "--verbose":
      case "-v":
        options.verbose = true;
        break;

      case "--help":
      case "-h":
        printHelp();
        process.exit(0);

      default:
        if (arg.startsWith("-")) {
          throw new Error(
            `Unknown option: ${arg}. Use --help for usage information.`,
          );
        }
    }
  }

  // Validate that start ledger is less than end ledger if both are specified
  if (
    options.endLedger !== undefined &&
    options.startLedger > options.endLedger
  ) {
    throw new Error(
      `Start ledger (${options.startLedger}) must be less than or equal to end ledger (${options.endLedger}).`,
    );
  }

  return options as ReplayOptions;
}

/**
 * Prints the help message for the replay command.
 */
export function printHelp(): void {
  console.log(`
Event Replay & Backfill Command
===============================

Usage: npm run replay [options]

Replays or backfills contract events to rebuild local indexed state.
Essential for indexers and local development when starting from an empty backend state.

Options:
  -f, --from-ledger <ledger> Starting ledger for backfill (default: 0)
  -t, --to-ledger <ledger>   Ending ledger for backfill (optional, defaults to latest)
  -b, --batch-size <number>  Number of ledgers to fetch per batch (default: 200, max: 10000)
  -c, --contract-id <id>     Contract ID to replay events for (default: env config)
  -r, --rpc <url>            Soroban RPC URL (default: env config)
  -o, --output <dir>         Output directory for cursor files (default: current directory)
      --checkpoint-every <n> Persist a checkpoint + resume token every n ledgers (default: batch size)
      --resume-token <token> Resume from an explicit token printed by a previous run
      --no-resume            Ignore the stored checkpoint and start at --from-ledger
      --projection-db <path> SQLite file for replay projections (default: DATABASE_PATH)
  -w, --clear                Wipe existing proposal, snapshot and projection state before replay
  -d, --dry-run              Print would-be projection writes without mutating storage
  -v, --verbose              Enable verbose logging output
      --type <types>         Filter by event types (comma-separated, e.g. PROPOSAL_CREATED,SIGNER_ADDED)
      --format <fmt>         Output format: 'human' (default) or 'json'
  -h, --help                 Show this help message

Examples:
  # Backfill all events from the beginning
  npm run replay

  # Backfill from ledger 1000 to 5000
  npm run replay -- --start 1000 --end 5000

  # Dry run to see what would be processed
  npm run replay -- --start 5000 --dry-run --verbose

  # Backfill with custom batch size for faster processing
  npm run replay -- --start 0 --batch-size 500

  # Backfill from a specific contract on a different RPC
  npm run replay -- --contract CDABC123... --rpc https://custom-rpc.example.com

  # Filter by event type and output as JSON
  npm run replay -- --type PROPOSAL_CREATED,PROPOSAL_EXECUTED --format json

  # Replay only signer events in human-readable format
  npm run replay -- --type SIGNER_ADDED,SIGNER_REMOVED --format human

  # Checkpointed resync of a contract range (re-running resumes after a crash)
  npm run replay -- --from-ledger 1000 --to-ledger 90000 --contract-id CDABC... --checkpoint-every 500

Environment Variables:
  CONTRACT_ID              Contract ID for the VaultDAO contract
  SOROBAN_RPC_URL          Soroban RPC endpoint URL
  STELLAR_NETWORK          Network to use (testnet, mainnet, futurenet, standalone)

Files:
  .event-cursor.json       Cursor file tracking the last processed ledger
  .replay-checkpoint.json  Checkpoint + resume token, stored next to the cursor file

Notes:
  - The command reuses existing event normalization logic from the events module
  - Cursor files allow safe resumption if the process is interrupted
  - Projections are idempotent: replaying an overlapping range skips events
    that were already applied
  - Use --dry-run first to test your configuration before a full backfill
  - Verbose mode (-v) shows detailed event processing information
`);
}

/**
 * Executes the replay command with parsed options.
 */
export async function executeReplay(args: string[]): Promise<void> {
  let options: ReplayOptions;

  try {
    options = parseReplayArgs(args);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[replay-cli] Error parsing arguments: ${errorMessage}`);
    console.error("Use --help for usage information.");
    process.exit(1);
  }

  console.log("[replay-cli] Loading environment configuration...");

  const env = loadEnv();

  const service = new EventReplayService(env, options);

  // Initialize downstream consumers
  const proposalPersistence = createMemoryPersistence();
  const proposalConsumer = new ProposalActivityConsumer();
  proposalConsumer.setPersistence(proposalPersistence);

  const snapshotAdapter = new MemorySnapshotAdapter();
  const snapshotService = new SnapshotService(snapshotAdapter);

  const isJsonOutput = options.outputFormat === "json";
  const contractId = options.contractId ?? env.contractId;
  const projectionStores = openProjectionStores(
    options.projectionDbPath ?? env.databasePath,
    options.dryRun,
  );
  const projectionWriter = new ReplayProjectionWriter({
    ...projectionStores,
    dryRun: options.dryRun,
    onWrite: options.dryRun
      ? (write) => printWouldBeWrite(write, isJsonOutput)
      : undefined,
  });

  if (options.clear) {
    console.log("[replay-cli] Clearing existing state...");
    await proposalPersistence.clear();
    await snapshotAdapter.clearSnapshot(contractId);
    if (options.dryRun) {
      console.log("[replay-cli] Dry run: projection tables are left untouched");
    } else {
      await projectionStores.proposals.clear();
      await projectionStores.recurring.clear();
      await service.clearCheckpoint();
    }
  }

  // Wire consumers to replay service
  service.registerBatchConsumer((events) =>
    proposalConsumer.processBatch(events),
  );
  service.registerConsumer(async (event) => {
    await snapshotService.processEvent(event);
  });
  // Critical: a failed projection write must stop the run before the next
  // checkpoint claims those ledgers were applied.
  service.registerBatchConsumer(
    async (events) => {
      await projectionWriter.applyBatch(events);
    },
    { critical: true },
  );

  // Check for existing cursor
  const hasCursor = await service.hasExistingCursor();
  if (hasCursor && !options.clear) {
    const lastLedger = await service.getLastProcessedLedger();
    console.log(
      `[replay-cli] Found existing cursor: last ledger = ${lastLedger}`,
    );
    console.log(
      "[replay-cli] Use --from-ledger to override or let replay continue from cursor position",
    );
  }

  const storedCheckpoint = options.dryRun ? null : await service.loadCheckpoint();
  if (storedCheckpoint && options.resume !== false && !options.resumeToken) {
    console.log(
      `[replay-cli] Found replay checkpoint ${storedCheckpoint.replayId} at ledger ${storedCheckpoint.lastCheckpointLedger}${storedCheckpoint.completed ? " (completed)" : ""}; it is resumed when it matches this contract and range`,
    );
  }

  if (options.eventTypes) {
    console.log(`[replay-cli] Filtering event types: ${options.eventTypes.join(", ")}`);
  }
  if (options.outputFormat) {
    console.log(`[replay-cli] Output format: ${options.outputFormat}`);
  }

  const typeFilter = options.eventTypes
    ? new Set(options.eventTypes.map((t) => t.toUpperCase()))
    : null;

  service.registerConsumer(async (event) => {
    if (typeFilter && !typeFilter.has(event.type)) return;
    if (isJsonOutput) {
      console.log(JSON.stringify(event));
    } else if (options.verbose) {
      console.log(
        `[${event.metadata.ledger}] ${event.type} | ${JSON.stringify(event.data)}`,
      );
    }
  });

  console.log("[replay-cli] Starting replay operation...");
  console.log("");

  let lastReportedLedger = -1;

  try {
    const stats = await service.replay((currentStats, currentLedger) => {
      const progress = computeProgress(currentStats, currentLedger);
      if (isJsonOutput) {
        console.log(JSON.stringify({ type: "progress", ...progress }));
        return;
      }

      // Print progress: Replayed ledger X/Y (Z events) every 1000 ledgers
      const progressLedger = Math.floor(currentLedger / 1000) * 1000;
      if (progressLedger > lastReportedLedger) {
        lastReportedLedger = progressLedger;
        const target =
          currentStats.targetLedger > 0 ? currentStats.targetLedger : "?";
        console.log(
          `Replayed ledger ${currentLedger}/${target} (${currentStats.totalEventsProcessed} events, ${progress.percentComplete}%, ${progress.eventsPerSecond} ev/s, checkpoint ${progress.lastCheckpointLedger ?? "-"})`,
        );
      }

      if (options.verbose) {
        console.log(
          `[replay-cli] Progress: ledger ${currentLedger}, processed: ${currentStats.totalEventsProcessed}`,
        );
      }
    });

    const report = buildReconciliationReport({
      contractId,
      dryRun: options.dryRun,
      fromLedger: options.startLedger,
      stats,
      projections: projectionWriter.summary(),
      checkpoint: service.getLastCheckpoint(),
    });

    console.log("");
    if (isJsonOutput) {
      console.log(JSON.stringify({ type: "report", ...report }));
    } else {
      console.log(formatReconciliationReport(report));
    }
    console.log("[replay-cli] Replay completed successfully!");

    if (stats.errorCount > 0) {
      console.warn(
        `[replay-cli] Warning: ${stats.errorCount} event(s) had processing errors. Check logs for details.`,
      );
    }

    process.exit(0);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[replay-cli] Fatal error: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Opens the proposal / recurring projection stores.
 *
 * In dry-run mode a database file that does not exist yet is never created:
 * in-memory stores stand in for it, so a dry run leaves the disk untouched.
 */
export function openProjectionStores(
  dbPath: string,
  dryRun: boolean,
): {
  proposals: StorageAdapter<ProposalProjection>;
  recurring: StorageAdapter<RecurringProjection>;
} {
  if (dbPath === ":memory:" || (dryRun && !existsSync(dbPath))) {
    return {
      proposals: new InMemoryStorageAdapter<ProposalProjection>(),
      recurring: new InMemoryStorageAdapter<RecurringProjection>(),
    };
  }
  return {
    proposals: new SqliteStorageAdapter<ProposalProjection>(
      dbPath,
      REPLAY_PROPOSAL_PROJECTION_TABLE,
    ),
    recurring: new SqliteStorageAdapter<RecurringProjection>(
      dbPath,
      REPLAY_RECURRING_PROJECTION_TABLE,
    ),
  };
}

/** Prints one dry-run would-be write. */
export function printWouldBeWrite(write: ProjectionWrite, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({ type: "would_write", ...write }));
    return;
  }
  const status = (write.record as { status?: string }).status ?? "";
  console.log(
    `[dry-run] would write ${write.projection} ${write.key} <- ${write.eventType} (${write.eventId}) status=${status}`,
  );
}

// Main entry point for CLI execution
const currentFilePath = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1] === currentFilePath;

if (isDirectExecution) {
  const cliArgs = process.argv.slice(2);
  void executeReplay(cliArgs);
}
