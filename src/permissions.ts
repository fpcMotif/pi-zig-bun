export type CanonicalCapability = "fs.read" | "fs.write" | "exec.run" | "net.http" | "session.access";
export type Capability = CanonicalCapability | "fs.execute";

export type PolicyPattern = string[] | "*";

export interface CapabilityPolicy {
  "fs.read"?: PolicyPattern;
  "fs.write"?: PolicyPattern;
  "exec.run"?: PolicyPattern;
  "fs.execute"?: PolicyPattern;
  "net.http"?: PolicyPattern;
  "session.access"?: PolicyPattern;
}

export interface ExecPolicy {
  allowlist?: string[];
  requireConfirmationForNonAllowlisted?: boolean;
  confirmer?: (command: string) => Promise<boolean> | boolean;
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

function pathAllowed(policyPatterns: PolicyPattern | undefined, target: string): boolean {
  if (!policyPatterns) {
    return false;
  }

  if (policyPatterns === "*") {
    return true;
  }

  const normalizedTarget = target.replace(/\\+/g, "/");
  return policyPatterns.some((pattern) => patternToRegex(pattern).test(normalizedTarget));
}

function normalizeCapability(capability: Capability): CanonicalCapability {
  if (capability === "fs.execute") {
    return "exec.run";
  }
  return capability;
}

function lookupPatterns(policy: CapabilityPolicy, capability: CanonicalCapability): PolicyPattern | undefined {
  if (capability === "exec.run") {
    return policy["exec.run"] ?? policy["fs.execute"];
  }
  return policy[capability];
}

export class CapabilityManager {
  public static readonly All: CapabilityPolicy = {
    "fs.read": "*",
    "fs.write": "*",
    "exec.run": "*",
    "net.http": "*",
    "session.access": "*",
  };

  constructor(
    private policy: CapabilityPolicy = {},
    private readonly execPolicy: ExecPolicy = {},
  ) {}

  public allowAll(): void {
    this.policy = { ...CapabilityManager.All };
  }

  public can(capability: Capability, target?: string): boolean {
    const normalized = normalizeCapability(capability);

    if (normalized !== "session.access" && !target) {
      return false;
    }

    const patterns = lookupPatterns(this.policy, normalized);
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
    const normalized = normalizeCapability(capability);
    if (!this.can(normalized, target)) {
      throw new Error(`Capability denied: ${normalized}${target ? ` (${target})` : ""}`);
    }
  }

  public async authorizeExec(command: string, target: string): Promise<void> {
    this.require("exec.run", target);

    const allowlist = this.execPolicy.allowlist ?? [];
    const allowlisted = allowlist.some((pattern) => patternToRegex(pattern).test(command));

    if (allowlisted || !this.execPolicy.requireConfirmationForNonAllowlisted) {
      return;
    }

    const confirmer = this.execPolicy.confirmer;
    const approved = confirmer ? await confirmer(command) : false;
    if (!approved) {
      throw new Error(`Execution denied pending confirmation: ${command}`);
    }
  }

  public updateFromMap(policy: CapabilityPolicy): void {
    this.policy = { ...this.policy, ...policy };
  }

  public snapshot(): CapabilityPolicy {
    return { ...this.policy };
  }
}

export type ToolResult = {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
};

export const __internal = {
  patternToRegex,
  normalizeCapability,
};
