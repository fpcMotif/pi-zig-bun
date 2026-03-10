import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ProviderName = "openai" | "anthropic" | "google";

interface ProviderFileConfig {
  provider?: ProviderName;
  timeoutMs?: number;
  maxRetries?: number;
  openai?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  anthropic?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
  google?: {
    apiKey?: string;
    model?: string;
    baseUrl?: string;
  };
}

export interface ProviderConfig {
  provider: ProviderName;
  timeoutMs: number;
  maxRetries: number;
  openai: Required<NonNullable<ProviderFileConfig["openai"]>>;
  anthropic: Required<NonNullable<ProviderFileConfig["anthropic"]>>;
  google: Required<NonNullable<ProviderFileConfig["google"]>>;
}

const DEFAULTS: ProviderConfig = {
  provider: "openai",
  timeoutMs: 60_000,
  maxRetries: 2,
  openai: {
    apiKey: "",
    model: "gpt-4o-mini",
    baseUrl: "https://api.openai.com/v1",
  },
  anthropic: {
    apiKey: "",
    model: "claude-3-5-haiku-latest",
    baseUrl: "https://api.anthropic.com/v1",
  },
  google: {
    apiKey: "",
    model: "gemini-1.5-flash",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },
};

function parseOptionalInt(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseProvider(value?: string): ProviderName | undefined {
  if (value === "openai" || value === "anthropic" || value === "google") {
    return value;
  }
  return undefined;
}

function readFileConfig(workspaceRoot: string): ProviderFileConfig {
  const filePath = path.join(workspaceRoot, ".pi", "providers.json");
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as ProviderFileConfig;
    return parsed;
  } catch {
    return {};
  }
}

export function loadProviderConfig(workspaceRoot: string): ProviderConfig {
  const file = readFileConfig(workspaceRoot);

  return {
    provider: parseProvider(process.env.PI_PROVIDER) ?? file.provider ?? DEFAULTS.provider,
    timeoutMs: parseOptionalInt(process.env.PI_PROVIDER_TIMEOUT_MS) ?? file.timeoutMs ?? DEFAULTS.timeoutMs,
    maxRetries: parseOptionalInt(process.env.PI_PROVIDER_MAX_RETRIES) ?? file.maxRetries ?? DEFAULTS.maxRetries,
    openai: {
      apiKey: process.env.OPENAI_API_KEY ?? file.openai?.apiKey ?? DEFAULTS.openai.apiKey,
      model: process.env.OPENAI_MODEL ?? file.openai?.model ?? DEFAULTS.openai.model,
      baseUrl: process.env.OPENAI_BASE_URL ?? file.openai?.baseUrl ?? DEFAULTS.openai.baseUrl,
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? file.anthropic?.apiKey ?? DEFAULTS.anthropic.apiKey,
      model: process.env.ANTHROPIC_MODEL ?? file.anthropic?.model ?? DEFAULTS.anthropic.model,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? file.anthropic?.baseUrl ?? DEFAULTS.anthropic.baseUrl,
    },
    google: {
      apiKey: process.env.GOOGLE_API_KEY ?? file.google?.apiKey ?? DEFAULTS.google.apiKey,
      model: process.env.GOOGLE_MODEL ?? file.google?.model ?? DEFAULTS.google.model,
      baseUrl: process.env.GOOGLE_BASE_URL ?? file.google?.baseUrl ?? DEFAULTS.google.baseUrl,
    },
  };
}
