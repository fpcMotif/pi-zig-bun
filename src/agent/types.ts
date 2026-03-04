export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
}

export interface AgentToolCall {
  id?: string;
  name: string;
  arguments: string;
}

export interface AgentRequest {
  messages: AgentMessage[];
  model?: string;
  temperature?: number;
}

export type AgentStreamEvent =
  | { type: "token"; token: string }
  | { type: "tool_call"; toolCall: AgentToolCall }
  | { type: "done"; response: AgentResponse }
  | { type: "error"; error: string };

export interface AgentResponse {
  text: string;
  toolCalls: AgentToolCall[];
  raw?: unknown;
}

export interface AgentStream {
  requestId: string;
  events: AsyncIterable<AgentStreamEvent>;
  cancel: () => Promise<void>;
}

export interface AgentAdapter {
  request(input: AgentRequest): Promise<AgentResponse>;
  stream(input: AgentRequest): Promise<AgentStream>;
  cancel(requestId: string): Promise<void>;
}
