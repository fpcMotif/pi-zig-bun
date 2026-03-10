export type ProviderId = "openai" | "anthropic" | "google";

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderSendRequest {
  messages: ProviderMessage[];
  model: string;
}

export interface ProviderSendResult {
  text: string;
}

export type ProviderStreamEvent =
  | { type: "delta"; token: string }
  | { type: "done" }
  | { type: "error"; error: ProviderError };

export interface ProviderClient {
  readonly id: ProviderId;
  send(request: ProviderSendRequest): Promise<ProviderSendResult>;
  stream(request: ProviderSendRequest): AsyncGenerator<ProviderStreamEvent>;
}

export type ProviderErrorCode = "auth_error" | "rate_limit" | "provider_error" | "network_error" | "invalid_response";

export class ProviderError extends Error {
  constructor(
    public readonly code: ProviderErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export interface ProviderRuntimeConfig {
  providerId: ProviderId;
  model: string;
  apiKey: string;
  apiKeySource: string;
  baseUrl?: string;
}

export function normalizeError(payload: { type?: string; message?: string; code?: string } | undefined): ProviderError {
  if (!payload) {
    return new ProviderError("provider_error", "Provider returned an unknown error");
  }
  if (payload.code === "invalid_api_key" || payload.type === "authentication_error") {
    return new ProviderError("auth_error", payload.message ?? "Authentication failed", payload);
  }
  if (payload.type === "rate_limit_error") {
    return new ProviderError("rate_limit", payload.message ?? "Rate limit exceeded", payload);
  }
  return new ProviderError("provider_error", payload.message ?? "Provider request failed", payload);
}
