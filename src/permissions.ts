import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type Capability =
  | "fs.read"
  | "fs.write"
  | "fs.execute"
  | "net.http"
  | "session.access";

export interface CapabilityPolicy {
  "fs.read"?: string[] | "*";
  "fs.write"?: string[] | "*";
  "fs.execute"?: string[] | "*";
  "net.http"?: string[] | "*";
  "session.access"?: string[] | "*";
}

export interface AuditRecord {
  timestamp: string;
  capability: Capability;
  resource?: string;
  caller?: string;
  outcome: "denied";
}

export interface CapabilityManagerOptions {
  auditLogPath?: string;
}

function patternToRegex(pattern: string): RegExp {
  if (pattern === "*" || pattern === "**") {
    return /.*/;
  }

  let regexSource = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      const nextIsStar = pattern[i + 1] === "*";
      if (nextIsStar) {
        regexSource += ".*";
        i += 1;
      } else {
        regexSource += "[^/\\\\]*";
      }
      continue;
    }

    if (ch === "?") {
      regexSource += ".";
      continue;
    }

    if ("\\.^$+()[]{}|".includes(ch)) {
      regexSource += `\\${ch}`;
      continue;
    }

    regexSource += ch;
  }

  return new RegExp(`${regexSource}$`);
}

function pathAllowed(policyPatterns: string[] | "*" | undefined, target: string): boolean {
  if (!policyPatterns) {
    return false;
  }

  if (policyPatterns === "*") {
    return true;
  }

  const normalizedTarget = target.replace(/\\+/g, "/");
  return policyPatterns.some((pattern) => patternToRegex(pattern).test(normalizedTarget));
}

export class CapabilityManager {
  public static readonly All: CapabilityPolicy = {
    "fs.read": "*",
    "fs.write": "*",
    "fs.execute": "*",
    "net.http": "*",
    "session.access": "*",
  };

  private readonly auditLogPath: string;

  constructor(
    private policy: CapabilityPolicy = {},
    options: CapabilityManagerOptions = {},
  ) {
    this.auditLogPath = options.auditLogPath ?? path.join(process.cwd(), ".pi", "audit.log");
  }

  public allowAll(): void {
    this.policy = {
      "fs.read": "*",
      "fs.write": "*",
      "fs.execute": "*",
      "net.http": "*",
      "session.access": "*",
    };
  }

  public can(capability: Capability, target?: string): boolean {
    if (capability !== "session.access" && !target) {
      return false;
    }

    const patterns = this.policy[capability];
    if (patterns === undefined) {
      return false;
    }

    if (patterns === "*") {
      return true;
    }

    if (!target) {
      return false;
    }

    return pathAllowed(patterns, target);
  }

  public require(capability: Capability, target?: string, caller?: string): void {
    if (!this.can(capability, target)) {
      this.logDenied({
        timestamp: new Date().toISOString(),
        capability,
        resource: target,
        caller,
        outcome: "denied",
      });
      throw new Error(`Capability denied: ${capability}${target ? ` (${target})` : ""}`);
    }
  }

  public updateFromMap(policy: CapabilityPolicy): void {
    this.policy = { ...this.policy, ...policy };
  }

  public snapshot(): CapabilityPolicy {
    return { ...this.policy };
  }

  private logDenied(record: AuditRecord): void {
    try {
      mkdirSync(path.dirname(this.auditLogPath), { recursive: true });
      appendFileSync(this.auditLogPath, `${JSON.stringify(record)}\n`, "utf8");
    } catch {
      // best-effort audit logging
    }
  }
}

export type ToolResult = {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
};
