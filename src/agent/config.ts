import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ProviderName } from "./types";

interface FileConfig {
  agent?: {
    provider?: ProviderName;
    model?: string;
    tokenBudget?: number;
  };
}

export interface AgentSelection {
  provider: ProviderName;
  model: string;
  apiKey?: string;
  tokenBudget: number;
  source: "cli" | "env" | "config" | "default";
}

export interface AgentOverrides {
  provider?: ProviderName;
  model?: string;
  tokenBudget?: number;
}

const DEFAULT_MODEL: Record<ProviderName, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-latest",
  google: "gemini-2.0-flash",
};

async function readConfig(workspaceRoot: string): Promise<FileConfig> {
  const file = path.join(workspaceRoot, ".pi", "config.json");
  try {
    const content = await readFile(file, "utf8");
    return JSON.parse(content) as FileConfig;
  } catch {
    return {};
  }
}

function parseProvider(raw?: string): ProviderName | undefined {
  if (!raw) {
    return undefined;
  }
  if (raw === "openai" || raw === "anthropic" || raw === "google") {
    return raw;
  }
  return undefined;
}

function keyForProvider(provider: ProviderName): string | undefined {
  switch (provider) {
    case "openai":
      return process.env.OPENAI_API_KEY;
    case "anthropic":
      return process.env.ANTHROPIC_API_KEY;
    case "google":
      return process.env.GOOGLE_API_KEY ?? process.env.GEMINI_API_KEY;
  }
}

export async function resolveAgentSelection(workspaceRoot: string, overrides: AgentOverrides): Promise<AgentSelection> {
  const cfg = await readConfig(workspaceRoot);
  const envProvider = parseProvider(process.env.PI_AGENT_PROVIDER);
  const provider = overrides.provider ?? envProvider ?? cfg.agent?.provider ?? "openai";
  const source = overrides.provider ? "cli" : envProvider ? "env" : cfg.agent?.provider ? "config" : "default";

  const model =
    overrides.model ??
    process.env.PI_AGENT_MODEL ??
    cfg.agent?.model ??
    DEFAULT_MODEL[provider];

  const envBudget = Number.parseInt(process.env.PI_AGENT_TOKEN_BUDGET ?? "", 10);
  const tokenBudget =
    overrides.tokenBudget ??
    (Number.isFinite(envBudget) ? envBudget : undefined) ??
    cfg.agent?.tokenBudget ??
    8_000;

  return {
    provider,
    model,
    apiKey: keyForProvider(provider),
    tokenBudget,
    source,
  };
}

export function missingApiKeyMessage(provider: ProviderName): string {
  switch (provider) {
    case "openai":
      return "Missing OPENAI_API_KEY. Set it, or choose --provider anthropic/google.";
    case "anthropic":
      return "Missing ANTHROPIC_API_KEY. Set it, or choose --provider openai/google.";
    case "google":
      return "Missing GOOGLE_API_KEY (or GEMINI_API_KEY). Set it, or choose --provider openai/anthropic.";
  }
}
