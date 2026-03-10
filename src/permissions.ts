import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

export type Capability =
  | "fs.read"
  | "fs.write"
  | "fs.execute"
  | "net.http"
  | "session.access";

const CAPABILITIES: Capability[] = ["fs.read", "fs.write", "fs.execute", "net.http", "session.access"];

export interface CapabilityPolicy {
  "fs.read"?: string[] | "*";
  "fs.write"?: string[] | "*";
  "fs.execute"?: string[] | "*";
  "net.http"?: string[] | "*";
  "session.access"?: string[] | "*";
}

export interface AuditRecord {
  timestamp: string;
  decision: "allow" | "deny";
  capability: Capability;
  target?: string;
  reason: string;
}

interface CapabilityManagerOptions {
  workspaceRoot?: string;
  auditLogPath?: string;
  sensitiveAllowCapabilities?: Capability[];
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

function normalizeForMatching(value: string): string {
  const normalized = path.normalize(value).replace(/\\+/g, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function buildMatchCandidates(target: string, workspaceRoot?: string): string[] {
  const absoluteTarget = normalizeForMatching(path.resolve(target));
  const candidates = new Set<string>([absoluteTarget]);

  if (workspaceRoot) {
    const absoluteWorkspaceRoot = normalizeForMatching(path.resolve(workspaceRoot));
    const relative = normalizeForMatching(path.relative(absoluteWorkspaceRoot, absoluteTarget));
    if (relative && relative !== "." && !relative.startsWith("../")) {
      candidates.add(relative);
    }
  }

  return [...candidates];
}

function pathAllowed(policyPatterns: string[] | "*" | undefined, target: string, workspaceRoot?: string): boolean {
  if (!policyPatterns) {
    return false;
  }

  if (policyPatterns === "*") {
    return true;
  }

  const targetCandidates = buildMatchCandidates(target, workspaceRoot);
  return policyPatterns.some((pattern) => {
    const normalizedPattern = normalizeForMatching(pattern);
    const matcher = patternToRegex(normalizedPattern);
    return targetCandidates.some((candidate) => matcher.test(candidate));
  });
}

function isCapability(value: string): value is Capability {
  return CAPABILITIES.includes(value as Capability);
}

function validateCapabilityEntry(capability: string, value: unknown): void {
  if (!isCapability(capability)) {
    throw new Error(`Invalid capability in policy: ${capability}`);
  }

  if (value === "*") {
    return;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Policy value for ${capability} must be "*" or string[]`);
  }
}

export function validateCapabilityPolicy(policyInput: unknown): CapabilityPolicy {
  if (policyInput === null || typeof policyInput !== "object" || Array.isArray(policyInput)) {
    throw new Error("Capability policy must be a JSON object");
  }

  const policy = policyInput as Record<string, unknown>;
  for (const [capability, value] of Object.entries(policy)) {
    validateCapabilityEntry(capability, value);
  }

  return policy as CapabilityPolicy;
}

function extractPolicyEnvelope(input: unknown): unknown {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const asRecord = input as Record<string, unknown>;
    if (asRecord.capabilities !== undefined) {
      return asRecord.capabilities;
    }
    if (asRecord.policy !== undefined) {
      return asRecord.policy;
    }
  }

  return input;
}

export function loadCapabilityPolicy(workspaceRoot: string): CapabilityPolicy {
  const policyPath = path.join(workspaceRoot, ".pi", "policy.json");
  const settingsPath = path.join(workspaceRoot, "settings.json");
  const configPath = existsSync(policyPath) ? policyPath : settingsPath;

  if (!existsSync(configPath)) {
    return {};
  }

  const raw = readFileSync(configPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const policyPayload = extractPolicyEnvelope(parsed);
  return validateCapabilityPolicy(policyPayload);
}

export class CapabilityManager {
  public static readonly All: CapabilityPolicy = {
    "fs.read": "*",
    "fs.write": "*",
    "fs.execute": "*",
    "net.http": "*",
    "session.access": "*",
  };

  private readonly workspaceRoot?: string;
  private readonly auditLogPath?: string;
  private readonly sensitiveAllowCapabilities: Set<Capability>;

  constructor(
    private policy: CapabilityPolicy = {},
    options: CapabilityManagerOptions = {},
  ) {
    this.workspaceRoot = options.workspaceRoot;
    this.auditLogPath = options.auditLogPath;
    this.sensitiveAllowCapabilities = new Set(options.sensitiveAllowCapabilities ?? ["fs.write", "fs.execute", "net.http"]);
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

    return pathAllowed(patterns, target, this.workspaceRoot);
  }

  public require(capability: Capability, target?: string): void {
    const allowed = this.can(capability, target);

    if (!allowed) {
      this.writeAudit({
        timestamp: new Date().toISOString(),
        decision: "deny",
        capability,
        target,
        reason: "policy-deny",
      });
      throw new Error(`Capability denied: ${capability}${target ? ` (${target})` : ""}`);
    }

    if (this.sensitiveAllowCapabilities.has(capability)) {
      this.writeAudit({
        timestamp: new Date().toISOString(),
        decision: "allow",
        capability,
        target,
        reason: "sensitive-allow",
      });
    }
  }

  public updateFromMap(policy: CapabilityPolicy): void {
    this.policy = { ...this.policy, ...policy };
  }

  public snapshot(): CapabilityPolicy {
    return { ...this.policy };
  }

  private writeAudit(event: AuditRecord): void {
    if (!this.auditLogPath) {
      return;
    }

    mkdirSync(path.dirname(this.auditLogPath), { recursive: true });
    appendFileSync(this.auditLogPath, `${JSON.stringify(event)}\n`, "utf8");
  }
}

export type ToolResult = {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
};
