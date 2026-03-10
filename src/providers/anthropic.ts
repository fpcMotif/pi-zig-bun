import { type ProviderChunk, type ProviderClient, ProviderError, type ProviderFinalMetadata, type ProviderSendOptions, withRetry } from "./index";
import { type ProviderConfig } from "./config";
import { readSseEvents } from "./stream";

export class AnthropicProviderClient implements ProviderClient {
  readonly name = "anthropic" as const;

  constructor(private readonly config: ProviderConfig) {}

  async *send(prompt: string, opts: ProviderSendOptions = {}): AsyncGenerator<ProviderChunk> {
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs;
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;
    yield* withRetry(this.name, (attempt) => this.sendAttempt(prompt, timeoutMs, attempt), maxRetries);
  }

  private async *sendAttempt(prompt: string, timeoutMs: number, _attempt: number): AsyncGenerator<ProviderChunk> {
    if (!this.config.anthropic.apiKey) {
      throw new ProviderError("ANTHROPIC_API_KEY is not configured", {
        provider: this.name,
        code: "misconfigured",
        retriable: false,
      });
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.config.anthropic.baseUrl}/messages`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-api-key": this.config.anthropic.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: this.config.anthropic.model,
          stream: true,
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok || !res.body) {
        throw new ProviderError(`Anthropic request failed with status ${res.status}`, {
          provider: this.name,
          code: res.status === 401 ? "auth_error" : res.status === 429 ? "rate_limited" : res.status >= 500 ? "server_error" : "network_error",
          status: res.status,
          retriable: res.status === 429 || res.status >= 500,
        });
      }

      let usage: ProviderFinalMetadata["usage"];
      for await (const eventData of readSseEvents(res.body)) {
        if (eventData === "[DONE]") {
          break;
        }

        const payload = JSON.parse(eventData) as {
          type?: string;
          delta?: { text?: string };
          usage?: { input_tokens?: number; output_tokens?: number };
        };

        if (payload.type === "content_block_delta" && payload.delta?.text) {
          yield { type: "token", token: payload.delta.text };
        }

        if (payload.usage) {
          usage = {
            inputTokens: payload.usage.input_tokens,
            outputTokens: payload.usage.output_tokens,
            totalTokens:
              (payload.usage.input_tokens ?? 0) +
              (payload.usage.output_tokens ?? 0),
          };
        }
      }

      yield {
        type: "final",
        metadata: {
          provider: this.name,
          model: this.config.anthropic.model,
          latencyMs: Date.now() - start,
          usage,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
