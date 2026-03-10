import { parseSseStream } from "./sse";
import {
  normalizeError,
  type ProviderClient,
  type ProviderMessage,
  ProviderError,
  type ProviderSendRequest,
  type ProviderSendResult,
  type ProviderStreamEvent,
} from "./types";

interface AnthropicConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class AnthropicProviderClient implements ProviderClient {
  public readonly id = "anthropic" as const;

  constructor(private readonly config: AnthropicConfig) {}

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    let text = "";
    for await (const event of this.stream(request)) {
      if (event.type === "delta") text += event.token;
      if (event.type === "error") throw event.error;
    }
    return { text };
  }

  async *stream(request: ProviderSendRequest): AsyncGenerator<ProviderStreamEvent> {
    const response = await fetch(`${this.config.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        max_tokens: 1024,
        messages: mapMessages(request.messages),
      }),
    });

    for await (const event of parseSseStream(response)) {
      if (event.event === "message_stop") {
        yield { type: "done" };
        return;
      }

      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        yield { type: "error", error: new ProviderError("invalid_response", "Could not parse Anthropic stream payload") };
        return;
      }

      if (event.event === "error") {
        yield { type: "error", error: normalizeError(payload.error) };
        return;
      }

      const token = payload.delta?.text;
      if (typeof token === "string" && token.length > 0) {
        yield { type: "delta", token };
      }
    }

    yield { type: "done" };
  }
}

function mapMessages(messages: ProviderMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const merged = messages.filter((message) => message.role !== "system");
  return merged.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: message.content,
  }));
}
