/**
 * Artifact collection for the VaultDAO e2e scenario pack.
 *
 * Each scenario run writes a JSON file to ./e2e-artifacts/ so that CI can
 * upload them on failure, giving engineers actionable tx hashes and ledger
 * sequences to trace on Stellar Expert.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScenarioArtifact {
  scenario: string;
  timestamp: string;
  status: "pass" | "fail";
  txHashes: string[];
  ledgers: number[];
  error?: string;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export class ArtifactCollector {
  private txHashes: string[] = [];
  private ledgers: number[] = [];
  private notes: string[] = [];

  addTx(hash: string, ledger?: number): void {
    this.txHashes.push(hash);
    if (ledger !== undefined) this.ledgers.push(ledger);
  }

  addNote(note: string): void {
    this.notes.push(note);
    console.log(`  [note] ${note}`);
  }

  /**
   * Serialise and write the artifact to disk.
   * Returns the absolute path of the written file.
   */
  async save(
    scenario: string,
    status: "pass" | "fail",
    error?: string
  ): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = join(process.cwd(), "e2e-artifacts");
    await mkdir(dir, { recursive: true });

    const filename = `${scenario}-${timestamp}.json`;
    const filepath = join(dir, filename);

    const artifact: ScenarioArtifact = {
      scenario,
      timestamp: new Date().toISOString(),
      status,
      txHashes: this.txHashes,
      ledgers: this.ledgers,
      error,
      notes: this.notes,
    };

    await writeFile(filepath, JSON.stringify(artifact, null, 2), "utf8");
    console.log(`  [artifact] written → ${filepath}`);
    return filepath;
  }
}
