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

  const normalizedTarget = path.posix.normalize(target.replace(/\\+/g, "/"));
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

  constructor(private policy: CapabilityPolicy = {}) {}

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

  public require(capability: Capability, target?: string): void {
    if (!this.can(capability, target)) {
      throw new Error(`Capability denied: ${capability}${target ? ` (${target})` : ""}`);
    }
  }

  public updateFromMap(policy: CapabilityPolicy): void {
    this.policy = { ...this.policy, ...policy };
  }

  public snapshot(): CapabilityPolicy {
    return { ...this.policy };
  }
}

export async function loadPolicyFile(policyPath: string): Promise<CapabilityPolicy> {
  try {
    const raw = await require("node:fs/promises").readFile(policyPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("policy.json must be a JSON object");
    }
    const policy: CapabilityPolicy = {};
    const validKeys: Capability[] = ["fs.read", "fs.write", "fs.execute", "net.http", "session.access"];
    for (const key of validKeys) {
      const value = parsed[key];
      if (value === "*") {
        policy[key] = "*";
      } else if (Array.isArray(value) && value.every((v: unknown) => typeof v === "string")) {
        policy[key] = value as string[];
      }
    }
    return policy;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

export type ToolResult = {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
};
