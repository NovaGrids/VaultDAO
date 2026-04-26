/**
 * EventReplayCLI
 *
 * Command-line interface for the event replay and backfill command.
 * Provides a user-friendly way to configure and execute replay operations.
 */

import type { ReplayOptions } from "./replay.types.js";
import { EventReplayService } from "./replay.service.js";
import { loadEnv } from "../../../config/env.js";
import { fileURLToPath } from "node:url";
import { createMemoryPersistence, ProposalActivityConsumer } from "../../proposals/index.js";
import { SnapshotService, MemorySnapshotAdapter } from "../../snapshots/index.js";

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
  -w, --clear                Wipe existing proposal and snapshot state before replay
  -d, --dry-run              Run without persisting state or processing events
  -v, --verbose              Enable verbose logging output
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

Environment Variables:
  CONTRACT_ID              Contract ID for the VaultDAO contract
  SOROBAN_RPC_URL          Soroban RPC endpoint URL
  STELLAR_NETWORK          Network to use (testnet, mainnet, futurenet, standalone)

Files:
  .event-cursor.json       Cursor file tracking the last processed ledger

Notes:
  - The command reuses existing event normalization logic from the events module
  - Cursor files allow safe resumption if the process is interrupted
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

  if (options.clear) {
    console.log("[replay-cli] Clearing existing state...");
    await proposalPersistence.clear();
    await snapshotAdapter.clearSnapshot(options.contractId ?? env.contractId);
  }

  // Wire consumers to replay service
  service.registerBatchConsumer((events) => proposalConsumer.processBatch(events));
  service.registerConsumer((event) => snapshotService.processEvent(event));

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

  console.log("[replay-cli] Starting replay operation...");
  console.log("");

  let lastReportedLedger = -1;

  try {
    const stats = await service.replay((currentStats, currentLedger) => {
      // Print progress: Replayed ledger X/Y (Z events) every 1000 ledgers
      const progressLedger = Math.floor(currentLedger / 1000) * 1000;
      if (progressLedger > lastReportedLedger) {
        lastReportedLedger = progressLedger;
        const target = currentStats.endLedger > 0 ? currentStats.endLedger : "?";
        console.log(
          `Replayed ledger ${currentLedger}/${target} (${currentStats.totalEventsProcessed} events)`
        );
      }
      
      if (options.verbose) {
        console.log(
          `[replay-cli] Progress: ledger ${currentLedger}, processed: ${currentStats.totalEventsProcessed}`,
        );
      }
    });

    console.log("");
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

// Main entry point for CLI execution
const currentFilePath = fileURLToPath(import.meta.url);
const isDirectExecution = process.argv[1] === currentFilePath;

if (isDirectExecution) {
  const cliArgs = process.argv.slice(2);
  void executeReplay(cliArgs);
}
