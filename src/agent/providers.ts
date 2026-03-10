import { parseChunkedTextStream, parseSseStream } from "./stream";
import type { AgentClientConfig, AgentMessage, CompletionOptions, ProviderClient, StreamEvent } from "./types";

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  if (!text) {
    return `${response.status} ${response.statusText}`;
  }

  return `${response.status} ${response.statusText}: ${text}`;
}

function ensureBody(response: Response): ReadableStream<Uint8Array> {
  if (!response.body) {
    throw new Error("Provider response did not include a body stream.");
  }
  return response.body;
}

function openAiToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const choices = (payload as { choices?: Array<{ delta?: { content?: string } }> }).choices;
  return choices?.[0]?.delta?.content;
}

function anthropicToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const event = payload as { type?: string; delta?: { text?: string } };
  if (event.type === "content_block_delta") {
    return event.delta?.text;
  }

  return undefined;
}

function googleToken(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }

  const data = payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text;
}

abstract class BaseProviderClient implements ProviderClient {
  constructor(protected readonly config: AgentClientConfig) {}

  abstract sendMessage(messages: AgentMessage[], options?: CompletionOptions): Promise<string>;
  abstract streamMessage(
    messages: AgentMessage[],
    onEvent: (event: StreamEvent) => void,
    options?: CompletionOptions,
  ): Promise<string>;
}

export class OpenAIClient extends BaseProviderClient {
  private endpoint(stream: boolean): string {
    const base = this.config.baseUrl ?? "https://api.openai.com/v1";
    return `${base}/chat/completions${stream ? "" : ""}`;
  }

  private payload(messages: AgentMessage[], stream: boolean): object {
    return {
      model: this.config.model,
      messages,
      stream,
    };
  }

  public async sendMessage(messages: AgentMessage[], options?: CompletionOptions): Promise<string> {
    const response = await fetch(this.endpoint(false), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(this.payload(messages, false)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed: ${await parseError(response)}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    return json.choices?.[0]?.message?.content ?? "";
  }

  public async streamMessage(
    messages: AgentMessage[],
    onEvent: (event: StreamEvent) => void,
    options?: CompletionOptions,
  ): Promise<string> {
    const response = await fetch(this.endpoint(true), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(this.payload(messages, true)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`OpenAI stream failed: ${await parseError(response)}`);
    }

    return parseSseStream(ensureBody(response), onEvent, openAiToken);
  }
}

export class AnthropicClient extends BaseProviderClient {
  private endpoint(): string {
    const base = this.config.baseUrl ?? "https://api.anthropic.com/v1";
    return `${base}/messages`;
  }

  private payload(messages: AgentMessage[], stream: boolean): object {
    const system = messages.filter((item) => item.role === "system").map((item) => item.content).join("\n\n");
    return {
      model: this.config.model,
      stream,
      max_tokens: 2048,
      system: system || undefined,
      messages: messages.filter((item) => item.role !== "system").map((item) => ({
        role: item.role,
        content: item.content,
      })),
    };
  }

  public async sendMessage(messages: AgentMessage[], options?: CompletionOptions): Promise<string> {
    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(this.payload(messages, false)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic request failed: ${await parseError(response)}`);
    }

    const json = (await response.json()) as { content?: Array<{ type?: string; text?: string }> };
    return json.content?.filter((item) => item.type === "text").map((item) => item.text ?? "").join("") ?? "";
  }

  public async streamMessage(
    messages: AgentMessage[],
    onEvent: (event: StreamEvent) => void,
    options?: CompletionOptions,
  ): Promise<string> {
    const response = await fetch(this.endpoint(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(this.payload(messages, true)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Anthropic stream failed: ${await parseError(response)}`);
    }

    return parseSseStream(ensureBody(response), onEvent, anthropicToken);
  }
}

export class GoogleGenAIClient extends BaseProviderClient {
  private endpoint(stream: boolean): string {
    const base = this.config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const action = stream ? "streamGenerateContent" : "generateContent";
    return `${base}/models/${this.config.model}:${action}?key=${encodeURIComponent(this.config.apiKey)}`;
  }

  private payload(messages: AgentMessage[]): object {
    return {
      contents: messages
        .filter((item) => item.role !== "system")
        .map((item) => ({
          role: item.role === "assistant" ? "model" : "user",
          parts: [{ text: item.content }],
        })),
      systemInstruction: {
        parts: messages
          .filter((item) => item.role === "system")
          .map((item) => ({ text: item.content })),
      },
    };
  }

  public async sendMessage(messages: AgentMessage[], options?: CompletionOptions): Promise<string> {
    const response = await fetch(this.endpoint(false), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.payload(messages)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Google GenAI request failed: ${await parseError(response)}`);
    }

    const json = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  }

  public async streamMessage(
    messages: AgentMessage[],
    onEvent: (event: StreamEvent) => void,
    options?: CompletionOptions,
  ): Promise<string> {
    const response = await fetch(this.endpoint(true), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.payload(messages)),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(`Google GenAI stream failed: ${await parseError(response)}`);
    }

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType.includes("text/event-stream")) {
      return parseSseStream(ensureBody(response), onEvent, googleToken);
    }

    return parseChunkedTextStream(ensureBody(response), onEvent);
  }
}

export function createProviderClient(provider: "openai" | "anthropic" | "google", config: AgentClientConfig): ProviderClient {
  switch (provider) {
    case "openai":
      return new OpenAIClient(config);
    case "anthropic":
      return new AnthropicClient(config);
    case "google":
      return new GoogleGenAIClient(config);
  }
}
