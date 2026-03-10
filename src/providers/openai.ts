import { type ProviderChunk, type ProviderClient, ProviderError, type ProviderFinalMetadata, type ProviderSendOptions, withRetry } from "./index";
import { type ProviderConfig } from "./config";
import { readSseEvents } from "./stream";

export class OpenAIProviderClient implements ProviderClient {
  readonly name = "openai" as const;

  constructor(private readonly config: ProviderConfig) {}

  async *send(prompt: string, opts: ProviderSendOptions = {}): AsyncGenerator<ProviderChunk> {
    const timeoutMs = opts.timeoutMs ?? this.config.timeoutMs;
    const maxRetries = opts.maxRetries ?? this.config.maxRetries;

    yield* withRetry(this.name, (attempt) => this.sendAttempt(prompt, timeoutMs, attempt), maxRetries);
  }

  private async *sendAttempt(prompt: string, timeoutMs: number, _attempt: number): AsyncGenerator<ProviderChunk> {
    if (!this.config.openai.apiKey) {
      throw new ProviderError("OPENAI_API_KEY is not configured", {
        provider: this.name,
        code: "misconfigured",
        retriable: false,
      });
    }

    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.config.openai.baseUrl}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.config.openai.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.openai.model,
          stream: true,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok || !res.body) {
        throw new ProviderError(`OpenAI request failed with status ${res.status}`, {
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
          choices?: Array<{ delta?: { content?: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
        };
        const token = payload.choices?.[0]?.delta?.content;
        if (token) {
          yield { type: "token", token };
        }

        if (payload.usage) {
          usage = {
            inputTokens: payload.usage.prompt_tokens,
            outputTokens: payload.usage.completion_tokens,
            totalTokens: payload.usage.total_tokens,
          };
        }
      }

      yield {
        type: "final",
        metadata: {
          provider: this.name,
          model: this.config.openai.model,
          latencyMs: Date.now() - start,
          usage,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
