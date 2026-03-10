export type RpcId = number;

export interface RpcRequest<TParams> {
  jsonrpc: "2.0";
  id: RpcId;
  method: string;
  params?: TParams;
}

export interface RpcSuccess<TResult> {
  jsonrpc: "2.0";
  id: RpcId;
  result: TResult;
}

export interface RpcError {
  code: number;
  message: string;
}

export interface RpcFailure {
  jsonrpc: "2.0";
  id: RpcId;
  error: RpcError;
}

export interface RpcNotification<TParams> {
  jsonrpc: "2.0";
  method: string;
  params?: TParams;
}

export interface UiState {
  mode: string;
  query: string;
  cursor: number;
}

export interface UiUpdateParams {
  state: UiState;
}

export interface UiUpdateResult {
  ok: boolean;
  acceptedAtMs: number;
}

export interface UiInputEvent {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  sequence?: string;
  receivedAtMs: number;
}
