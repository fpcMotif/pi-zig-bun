import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
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

export type ApprovalMode = "auto" | "prompt" | "allow" | "deny";

export interface RuntimePolicy {
  capabilities?: CapabilityPolicy;
  toolAllowlist?: string[];
  extensionAllowlist?: string[];
  approval?: {
    mode?: ApprovalMode;
    promptCapabilities?: Capability[];
  };
}

export interface CapabilityCheckResult {
  allowed: boolean;
  resultCode:
    | "allowed"
    | "denied_policy"
    | "denied_tool"
    | "denied_extension"
    | "denied_no_target"
    | "denied_prompt"
    | "allowed_prompt";
}

export interface AuditLogRecord {
  timestamp: string;
  caller: string;
  capability: Capability;
  target?: string;
  resultCode: CapabilityCheckResult["resultCode"];
}

export interface CapabilityApprovalHandler {
  requestApproval: (input: {
    capability: Capability;
    target?: string;
    caller: string;
    reason: string;
  }) => Promise<boolean>;
}

const HIGH_RISK_CAPABILITIES: Capability[] = ["fs.execute", "net.http"];

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

function readJsonFile<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const payload = readFileSync(filePath, "utf8");
    return JSON.parse(payload) as T;
  } catch {
    return null;
  }
}

export function loadRuntimePolicy(workspaceRoot: string): RuntimePolicy {
  const dotPiPath = path.join(workspaceRoot, ".pi", "policy.json");
  const settingsPath = path.join(workspaceRoot, "settings.json");

  const dotPiPolicy = readJsonFile<RuntimePolicy>(dotPiPath);
  if (dotPiPolicy) {
    return dotPiPolicy;
  }

  const settings = readJsonFile<Record<string, unknown>>(settingsPath);
  if (!settings) {
    return {};
  }

  const nested = settings.policy as RuntimePolicy | undefined;
  if (nested && typeof nested === "object") {
    return nested;
  }

  return settings as RuntimePolicy;
}

export class CapabilityManager {
  constructor(
    private policy: CapabilityPolicy = {},
    private options: {
      approvalMode?: ApprovalMode;
      approvalHandler?: CapabilityApprovalHandler;
      promptCapabilities?: Capability[];
      auditLogPath?: string;
      toolAllowlist?: string[];
      extensionAllowlist?: string[];
      allowUncategorizedTools?: boolean;
    } = {},
  ) {}

  public can(capability: Capability, target?: string): CapabilityCheckResult {
    if (capability !== "session.access" && !target) {
      return { allowed: false, resultCode: "denied_no_target" };
    }

    const patterns = this.policy[capability];
    if (patterns === undefined) {
      return { allowed: false, resultCode: "denied_policy" };
    }

    if (patterns === "*") {
      return { allowed: true, resultCode: "allowed" };
    }

    if (!target) {
      return { allowed: false, resultCode: "denied_no_target" };
    }

    return pathAllowed(patterns, target)
      ? { allowed: true, resultCode: "allowed" }
      : { allowed: false, resultCode: "denied_policy" };
  }

  public async requireTool(toolId: string, source: "builtin" | "extension", caller = "tool-registry"): Promise<void> {
    const allowedTools = this.options.toolAllowlist;
    if (allowedTools && !allowedTools.includes(toolId)) {
      this.audit({
        caller,
        capability: "session.access",
        resultCode: source === "extension" ? "denied_extension" : "denied_tool",
        target: toolId,
      });
      throw new Error(`Tool denied by allowlist: ${toolId}`);
    }

    if (source === "extension") {
      const allowedExtensions = this.options.extensionAllowlist;
      if (allowedExtensions && !allowedExtensions.includes(toolId)) {
        this.audit({
          caller,
          capability: "session.access",
          resultCode: "denied_extension",
          target: toolId,
        });
        throw new Error(`Extension tool denied by allowlist: ${toolId}`);
      }
    }

    if (!allowedTools && !this.options.allowUncategorizedTools) {
      this.audit({
        caller,
        capability: "session.access",
        resultCode: source === "extension" ? "denied_extension" : "denied_tool",
        target: toolId,
      });
      throw new Error(`Tool denied (explicit grant required): ${toolId}`);
    }
  }

  public async require(capability: Capability, target: string | undefined, caller = "tool"): Promise<void> {
    const base = this.can(capability, target);
    if (!base.allowed) {
      this.audit({ caller, capability, target, resultCode: base.resultCode });
      throw new Error(`Capability denied: ${capability}${target ? ` (${target})` : ""}`);
    }

    const needsPrompt = this.shouldPrompt(capability);
    if (!needsPrompt) {
      this.audit({ caller, capability, target, resultCode: "allowed" });
      return;
    }

    const approved = await this.approve(capability, target, caller);
    this.audit({
      caller,
      capability,
      target,
      resultCode: approved ? "allowed_prompt" : "denied_prompt",
    });

    if (!approved) {
      throw new Error(`Capability denied by approval flow: ${capability}${target ? ` (${target})` : ""}`);
    }
  }

  public updateFromMap(policy: CapabilityPolicy): void {
    this.policy = { ...this.policy, ...policy };
  }

  public snapshot(): CapabilityPolicy {
    return { ...this.policy };
  }

  private shouldPrompt(capability: Capability): boolean {
    const mode = this.options.approvalMode ?? "auto";
    if (mode === "allow") {
      return false;
    }
    if (mode === "deny") {
      return true;
    }

    const prompted = this.options.promptCapabilities ?? HIGH_RISK_CAPABILITIES;
    return prompted.includes(capability);
  }

  private async approve(capability: Capability, target: string | undefined, caller: string): Promise<boolean> {
    const mode = this.options.approvalMode ?? "auto";
    if (mode === "allow") {
      return true;
    }

    if (mode === "deny") {
      return false;
    }

    const handler = this.options.approvalHandler;
    if (!handler) {
      return false;
    }

    return handler.requestApproval({
      capability,
      target,
      caller,
      reason: "high-risk capability requires explicit approval",
    });
  }

  private audit(input: Omit<AuditLogRecord, "timestamp">): void {
    if (!this.options.auditLogPath) {
      return;
    }

    const record: AuditLogRecord = {
      timestamp: new Date().toISOString(),
      ...input,
    };

    const dir = path.dirname(this.options.auditLogPath);
    mkdirSync(dir, { recursive: true });
    appendFileSync(this.options.auditLogPath, `${JSON.stringify(record)}\n`, "utf8");
  }
}

export type ToolResult = {
  ok: boolean;
  output?: string;
  error?: string;
  data?: unknown;
};
