import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export interface ToolAuditEvent {
  timestamp: string;
  toolId: string;
  capability: string;
  target?: string;
  result: "ok" | "error";
  message?: string;
}

export interface ToolAuditLogger {
  log(event: ToolAuditEvent): void;
}

export class ImmutableAuditLogger implements ToolAuditLogger {
  private previousHash = "";

  constructor(private readonly logPath: string) {
    mkdirSync(path.dirname(logPath), { recursive: true });

    if (existsSync(logPath)) {
      const lines = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean);
      if (lines.length > 0) {
        const lastLine = lines[lines.length - 1]!;
        try {
          const parsed = JSON.parse(lastLine) as { hash?: string };
          this.previousHash = parsed.hash ?? "";
        } catch {
          this.previousHash = "";
        }
      }
    }
  }

  public log(event: ToolAuditEvent): void {
    const payload = {
      ...event,
      prevHash: this.previousHash,
    };

    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    const record = {
      ...payload,
      hash,
    };

    appendFileSync(this.logPath, `${JSON.stringify(record)}\n`, "utf8");
    this.previousHash = hash;
  }
}
