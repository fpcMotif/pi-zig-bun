import { AnthropicProviderClient } from "./anthropic";
import { loadProviderConfig, type ProviderConfig, type ProviderName } from "./config";
import { GoogleProviderClient } from "./google";
import { OpenAIProviderClient } from "./openai";

export interface ProviderFinalMetadata {
  provider: ProviderName;
  model: string;
  latencyMs: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  raw?: Record<string, unknown>;
}

export type ProviderChunk =
  | { type: "token"; token: string }
  | { type: "final"; metadata: ProviderFinalMetadata };

export interface ProviderSendOptions {
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ProviderClient {
  readonly name: ProviderName;
  send(prompt: string, opts?: ProviderSendOptions): AsyncGenerator<ProviderChunk>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly details: {
      provider: ProviderName;
      code:
        | "auth_error"
        | "rate_limited"
        | "timeout"
        | "network_error"
        | "invalid_response"
        | "server_error"
        | "misconfigured"
        | "unknown";
      status?: number;
      retriable: boolean;
      cause?: unknown;
    },
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderClientFactoryResult {
  client: ProviderClient;
  config: ProviderConfig;
}

export function createProviderClient(workspaceRoot: string): ProviderClientFactoryResult {
  const config = loadProviderConfig(workspaceRoot);

  switch (config.provider) {
    case "openai":
      return { client: new OpenAIProviderClient(config), config };
    case "anthropic":
      return { client: new AnthropicProviderClient(config), config };
    case "google":
      return { client: new GoogleProviderClient(config), config };
    default:
      throw new ProviderError(`Unsupported provider: ${String(config.provider)}`, {
        provider: config.provider as ProviderName,
        code: "misconfigured",
        retriable: false,
      });
  }
}

export function asProviderError(provider: ProviderName, err: unknown): ProviderError {
  if (err instanceof ProviderError) {
    return err;
  }

  if (err instanceof DOMException && err.name === "AbortError") {
    return new ProviderError("Provider request timed out", {
      provider,
      code: "timeout",
      retriable: true,
      cause: err,
    });
  }

  if (err instanceof TypeError) {
    return new ProviderError(err.message, {
      provider,
      code: "network_error",
      retriable: true,
      cause: err,
    });
  }

  if (err instanceof Error) {
    return new ProviderError(err.message, {
      provider,
      code: "unknown",
      retriable: false,
      cause: err,
    });
  }

  return new ProviderError("Unknown provider failure", {
    provider,
    code: "unknown",
    retriable: false,
    cause: err,
  });
}

export async function* withRetry(
  provider: ProviderName,
  operation: (attempt: number) => AsyncGenerator<ProviderChunk>,
  maxRetries: number,
): AsyncGenerator<ProviderChunk> {
  let attempt = 0;

  while (attempt <= maxRetries) {
    let emitted = false;
    try {
      for await (const chunk of operation(attempt + 1)) {
        emitted = true;
        yield chunk;
      }
      return;
    } catch (error) {
      const providerError = asProviderError(provider, error);
      const canRetry = providerError.details.retriable && !emitted && attempt < maxRetries;
      if (!canRetry) {
        throw providerError;
      }
      attempt += 1;
    }
  }
}
