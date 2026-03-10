import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CapabilityPolicy } from "../permissions";

interface PolicyContainer {
  policy?: CapabilityPolicy;
  capabilities?: CapabilityPolicy;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseCapabilityPolicy(raw: unknown): CapabilityPolicy {
  if (!isObject(raw)) {
    return {};
  }

  const source = raw as CapabilityPolicy;
  const policy: CapabilityPolicy = {};

  for (const capability of ["fs.read", "fs.write", "fs.execute", "net.http", "session.access"] as const) {
    const value = source[capability];
    if (value === "*") {
      policy[capability] = "*";
      continue;
    }

    if (Array.isArray(value)) {
      policy[capability] = value.filter((entry): entry is string => typeof entry === "string");
    }
  }

  return policy;
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return undefined;
  }
}

function policyFromSettings(raw: unknown): CapabilityPolicy {
  if (!isObject(raw)) {
    return {};
  }

  const container = raw as PolicyContainer;
  if (container.policy !== undefined) {
    return parseCapabilityPolicy(container.policy);
  }

  if (container.capabilities !== undefined) {
    return parseCapabilityPolicy(container.capabilities);
  }

  return parseCapabilityPolicy(raw);
}

export function loadCapabilityPolicy(workspaceRoot: string): CapabilityPolicy {
  const primaryPath = path.join(workspaceRoot, ".pi", "policy.json");
  if (existsSync(primaryPath)) {
    return parseCapabilityPolicy(readJsonFile(primaryPath));
  }

  const fallbackPath = path.join(workspaceRoot, "settings.json");
  if (existsSync(fallbackPath)) {
    return policyFromSettings(readJsonFile(fallbackPath));
  }

  return {};
}
