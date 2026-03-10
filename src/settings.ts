import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CapabilityPolicy, ExecPolicy } from "./permissions";

export interface AppSettings {
  capabilities?: CapabilityPolicy;
  exec?: {
    allowlist?: string[];
    requireConfirmationForNonAllowlisted?: boolean;
  };
}

function readSettingsFile(filePath: string): AppSettings {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as AppSettings;
  } catch {
    return {};
  }
}

export function loadSettings(workspaceRoot: string): AppSettings {
  const userSettingsPath = path.join(os.homedir(), ".pi", "settings.json");
  const projectSettingsPath = path.join(workspaceRoot, ".pi", "settings.json");

  const userSettings = readSettingsFile(userSettingsPath);
  const projectSettings = readSettingsFile(projectSettingsPath);

  return {
    capabilities: {
      ...(userSettings.capabilities ?? {}),
      ...(projectSettings.capabilities ?? {}),
    },
    exec: {
      ...(userSettings.exec ?? {}),
      ...(projectSettings.exec ?? {}),
      allowlist: projectSettings.exec?.allowlist ?? userSettings.exec?.allowlist ?? [],
    },
  };
}

export function toExecPolicy(settings: AppSettings, confirmer?: ExecPolicy["confirmer"]): ExecPolicy {
  return {
    allowlist: settings.exec?.allowlist ?? [],
    requireConfirmationForNonAllowlisted: settings.exec?.requireConfirmationForNonAllowlisted ?? false,
    confirmer,
  };
}
