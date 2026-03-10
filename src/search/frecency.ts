import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";

export class FrecencyStore {
  private readonly db: Database;

  constructor(workspaceRoot: string) {
    const stateDir = path.join(workspaceRoot, ".pi");
    mkdirSync(stateDir, { recursive: true });
    this.db = new Database(path.join(stateDir, "frecency.sqlite"));
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS frecency (
        path TEXT PRIMARY KEY,
        score REAL NOT NULL,
        last_opened_ms INTEGER NOT NULL
      );
    `);
  }

  public touch(filePath: string, nowMs = Date.now()): void {
    const row = this.db
      .query("SELECT score, last_opened_ms FROM frecency WHERE path = ?1")
      .get(filePath) as { score: number; last_opened_ms: number } | null;

    const decayed = row ? this.decay(row.score, nowMs - row.last_opened_ms) : 0;
    const next = Math.min(1, decayed + 0.25);

    this.db
      .query(
        "INSERT INTO frecency(path, score, last_opened_ms) VALUES (?1, ?2, ?3) ON CONFLICT(path) DO UPDATE SET score = excluded.score, last_opened_ms = excluded.last_opened_ms",
      )
      .run(filePath, next, nowMs);
  }

  public snapshot(limit = 500): Record<string, number> {
    const rows = this.db
      .query("SELECT path, score FROM frecency ORDER BY score DESC, last_opened_ms DESC LIMIT ?1")
      .all(limit) as Array<{ path: string; score: number }>;

    const out: Record<string, number> = {};
    for (const row of rows) {
      out[row.path] = Math.max(0, Math.min(1, row.score));
    }
    return out;
  }

  private decay(score: number, deltaMs: number): number {
    const hours = Math.max(0, deltaMs / 3_600_000);
    return score * Math.exp(-hours / 72);
  }
}
