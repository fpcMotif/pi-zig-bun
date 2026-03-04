export type UiEventKind = "status" | "token" | "tool_call" | "done" | "error";

export interface UiUpdateParams {
  turnId: string;
  kind: UiEventKind;
  message?: string;
  token?: string;
  done?: boolean;
  meta?: Record<string, unknown>;
}

export interface UiInputParams {
  turnId: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface UiAck {
  ok: boolean;
  received_at_ms: number;
}
