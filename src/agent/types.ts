export interface AgentMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;

  /**
   * Present on assistant messages that requested tool calls.
   * Wire format matches OpenAI: { id, type: "function", function: { name, arguments } }
   */
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;

  /**
   * Present on tool-result messages (role === "tool").
   * References the originating tool_call id so the LLM can correlate results.
   */
  tool_call_id?: string;
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
