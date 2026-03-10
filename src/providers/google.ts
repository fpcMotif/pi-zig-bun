import { type ProviderChunk, type ProviderClient, ProviderError, type ProviderFinalMetadata, type ProviderSendOptions, withRetry } from "./index";
import { type ProviderConfig } from "./config";
import { readSseEvents } from "./stream";

export class GoogleProviderClient implements ProviderClient {
  readonly name = "google" as const;

  constructor(private readonly config: ProviderConfig) {}

  async *send(prompt: string, opts: ProviderSendOptions = {}): AsyncGenerator<ProviderChunk> {
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs;
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;
    yield* withRetry(this.name, (attempt) => this.sendAttempt(prompt, timeoutMs, attempt), maxRetries);
  }

  private async *sendAttempt(prompt: string, timeoutMs: number, _attempt: number): AsyncGenerator<ProviderChunk> {
    if (!this.config.google.apiKey) {
      throw new ProviderError("GOOGLE_API_KEY is not configured", {
        provider: this.name,
        code: "misconfigured",
        retriable: false,
      });
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const endpoint = `${this.config.google.baseUrl}/models/${this.config.google.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.config.google.apiKey)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        }),
      });

      if (!res.ok || !res.body) {
        throw new ProviderError(`Google request failed with status ${res.status}`, {
          provider: this.name,
          code: res.status === 401 ? "auth_error" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "server_error" : "network_error",
          status: res.status,
          retriable: res.status === 429 || res.status >= 500,
        });
      }

      let usage: ProviderFinalMetadata["usage"];
      for await (const eventData of readSseEvents(res.body)) {
        const payload = JSON.parse(eventData) as {
          candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
          usageMetadata?: {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
            totalTokenCount?: number;
          };
        };

        const token = payload.candidates?.[0]?.content?.parts?.[0]?.text;
        if (token) {
          yield { type: "token", token };
        }

        if (payload.usageMetadata) {
          usage = {
            inputTokens: payload.usageMetadata.promptTokenCount,
            outputTokens: payload.usageMetadata.candidatesTokenCount,
            totalTokens: payload.usageMetadata.totalTokenCount,
          };
        }
      }

      yield {
        type: "final",
        metadata: {
          provider: this.name,
          model: this.config.google.model,
          latencyMs: Date.now() - start,
          usage,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
