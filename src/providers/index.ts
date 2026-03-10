import { AnthropicProviderClient } from "./anthropic";
import { GoogleProviderClient } from "./google";
import { OpenAIProviderClient } from "./openai";
import { ProviderError, type ProviderClient, type ProviderRuntimeConfig } from "./types";

export function createProviderClient(config: ProviderRuntimeConfig): ProviderClient {
  switch (config.providerId) {
    case "openai":
      return new OpenAIProviderClient({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });
    case "anthropic":
      return new AnthropicProviderClient({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });
    case "google":
      return new GoogleProviderClient({ apiKey: config.apiKey, model: config.model, baseUrl: config.baseUrl });
    default:
      throw new ProviderError("invalid_response", `Unsupported provider: ${String(config.providerId)}`);
  }
}

export function resolveProviderRuntimeConfig(env: NodeJS.ProcessEnv = process.env): ProviderRuntimeConfig {
  const providerId = (env.PI_PROVIDER ?? "openai") as ProviderRuntimeConfig["providerId"];
  const model = env.PI_MODEL ?? defaultModel(providerId);

  const sourceByProvider: Record<ProviderRuntimeConfig["providerId"], string> = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GOOGLE_API_KEY",
  };

  const apiKeySource = sourceByProvider[providerId] ?? "PI_API_KEY";
  const apiKey = env[apiKeySource] ?? env.PI_API_KEY;
  if (!apiKey) {
    throw new ProviderError("auth_error", `Missing API key. Set ${apiKeySource} or PI_API_KEY.`);
  }

  return {
    providerId,
    model,
    apiKey,
    apiKeySource,
    baseUrl: env.PI_PROVIDER_BASE_URL,
  };
}

function defaultModel(providerId: ProviderRuntimeConfig["providerId"]): string {
  switch (providerId) {
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "google":
      return "gemini-1.5-flash";
    case "openai":
    default:
      return "gpt-4o-mini";
  }
}
