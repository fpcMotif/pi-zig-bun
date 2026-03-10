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

interface GoogleConfig {
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export class GoogleProviderClient implements ProviderClient {
  public readonly id = "google" as const;

  constructor(private readonly config: GoogleConfig) {}

  async send(request: ProviderSendRequest): Promise<ProviderSendResult> {
    let text = "";
    for await (const event of this.stream(request)) {
      if (event.type === "delta") text += event.token;
      if (event.type === "error") throw event.error;
    }
    return { text };
  }

  async *stream(request: ProviderSendRequest): AsyncGenerator<ProviderStreamEvent> {
    const response = await fetch(
      `${this.config.baseUrl ?? "https://generativelanguage.googleapis.com"}/v1beta/models/${request.model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(this.config.apiKey)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: mapMessages(request.messages) }),
      },
    );

    for await (const event of parseSseStream(response)) {
      let payload: any;
      try {
        payload = JSON.parse(event.data);
      } catch {
        yield { type: "error", error: new ProviderError("invalid_response", "Could not parse Google stream payload") };
        return;
      }

      if (payload.error) {
        yield { type: "error", error: normalizeError(payload.error) };
        return;
      }

      const token = payload.candidates?.[0]?.content?.parts?.[0]?.text;
      if (typeof token === "string" && token.length > 0) {
        yield { type: "delta", token };
      }
    }

    yield { type: "done" };
  }
}

function mapMessages(messages: ProviderMessage[]): Array<{ role: string; parts: Array<{ text: string }> }> {
  return messages.map((message) => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}
