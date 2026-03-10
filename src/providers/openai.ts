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

interface OpenAIConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class OpenAIProviderClient implements ProviderClient {
  public readonly id = "openai" as const;

  constructor(private readonly config: OpenAIConfig) {}

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    let text = "";
    for await (const event of this.stream(request)) {
      if (event.type === "delta") text += event.token;
      if (event.type === "error") throw event.error;
    }
    return { text };
  }

  async *stream(request: ProviderSendRequest): AsyncGenerator<ProviderStreamEvent> {
    const response = await fetch(`${this.config.baseUrl ?? "https://api.openai.com"}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: request.model,
        stream: true,
        messages: mapMessages(request.messages),
      }),
    });

    for await (const event of parseSseStream(response)) {
      if (event.data === "[DONE]") {
        yield { type: "done" };
        return;
      }

      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        yield { type: "error", error: new ProviderError("invalid_response", "Could not parse OpenAI stream payload") };
        return;
      }

      if (payload.error) {
        yield { type: "error", error: normalizeError(payload.error) };
        return;
      }

      const token = payload.choices?.[0]?.delta?.content;
      if (typeof token === "string" && token.length > 0) {
        yield { type: "delta", token };
      }
    }

    yield { type: "done" };
  }
}

function mapMessages(messages: ProviderMessage[]): Array<{ role: string; content: string }> {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}
