export type ProviderName = "openai" | "anthropic" | "google";

export interface AgentMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface StreamEvent {
  type: "token" | "done" | "error" | "meta";
  token?: string;
  message?: string;
  data?: unknown;
}

export interface CompletionOptions {
  signal?: AbortSignal;
}

export interface ProviderClient {
  sendMessage(messages: AgentMessage[], options?: CompletionOptions): Promise<string>;
  streamMessage(
    messages: AgentMessage[],
    onEvent: (event: StreamEvent) => void,
    options?: CompletionOptions,
  ): Promise<string>;
}

export interface AgentClientConfig {
  model: string;
  apiKey: string;
  baseUrl?: string;
}
