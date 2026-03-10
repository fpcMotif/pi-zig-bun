import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type {
  RpcFailure,
  RpcId,
  RpcNotification,
  RpcRequest,
  RpcSuccess,
  UiInputEvent,
  UiUpdateParams,
  UiUpdateResult,
} from "../rpc/types";

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutHandle?: ReturnType<typeof setTimeout>;
}

export interface SearchBridgeOptions {
  binaryPath?: string;
  workspaceRoot?: string;
  requestTimeoutMs?: number;
}

export function parseRpcLine(line: string):
  | RpcSuccess<unknown>
  | RpcFailure
  | RpcNotification<unknown>
  | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  const payload = JSON.parse(trimmed) as Partial<RpcSuccess<unknown> & RpcFailure & RpcNotification<unknown>>;
  if (payload.jsonrpc !== "2.0") {
    throw new Error("invalid jsonrpc version");
  }

  if (typeof payload.method === "string") {
    return {
      jsonrpc: "2.0",
      method: payload.method,
      params: payload.params,
    };
  }

  if (typeof payload.id !== "number") {
    throw new Error("invalid rpc id");
  }

  if (payload.error && typeof payload.error.code === "number" && typeof payload.error.message === "string") {
    return {
      jsonrpc: "2.0",
      id: payload.id,
      error: payload.error,
    };
  }

  if ("result" in payload) {
    return {
      jsonrpc: "2.0",
      id: payload.id,
      result: payload.result,
    };
  }

  throw new Error("invalid rpc payload");
}

export function formatRpcRequest(payload: RpcRequest<unknown>): string {
  return `${JSON.stringify(payload)}\n`;
}

export class SearchBridge {
  private readonly binaryPath: string;
  private readonly workspaceRoot: string;
  private readonly requestTimeoutMs: number;
  private proc?: ReturnType<typeof spawn>;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<RpcId, PendingCall>();
  private started = false;
  private readonly uiInputSubscribers = new Set<(event: UiInputEvent) => void>();

  constructor(options: SearchBridgeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.binaryPath = this.resolveBinary(options.binaryPath);
  }

  private resolveBinary(explicit?: string): string {
    if (explicit) {
      return explicit;
    }

    const binaryName = process.platform === "win32" ? "pi-zig-search.exe" : "pi-zig-search";
    const candidates = [
      path.join(this.workspaceRoot, "zig-out", "bin", binaryName),
      path.join(process.cwd(), "zig-out", "bin", binaryName),
      path.join(process.cwd(), ".zig-cache", "o", "bin", binaryName),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }

    return candidates[0]!;
  }

  public async start(): Promise<void> {
    if (this.started) {
      return;
    }

    if (!existsSync(this.binaryPath)) {
      throw new Error(
        [
          `Zig search binary missing: ${this.binaryPath}`,
          "Run `zig build` before starting pi-zig-bun.",
          "If you use a custom binary path, pass { binaryPath } when creating SearchBridge.",
        ].join(" "),
      );
    }

    this.proc = spawn(this.binaryPath, {
      cwd: this.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    if (!this.proc.stdin || !this.proc.stdout) {
      throw new Error("Failed to initialize search bridge stdin/stdout streams");
    }

    this.started = true;
    mkdirSync(path.join(this.workspaceRoot, ".pi"), { recursive: true });
    const stderrLog = path.join(this.workspaceRoot, ".pi", "search-bridge.stderr.log");

    if (this.proc.stderr) {
      this.proc.stderr.on("data", (chunk) => {
        appendFileSync(stderrLog, chunk);
      });
    }

    this.stdoutBuffer = "";
    this.proc.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString();
      while (true) {
        const newlineIndex = this.stdoutBuffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = this.stdoutBuffer.slice(0, newlineIndex);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        this.handleLine(line);
      }
    });

    this.proc.on("close", (code, signal) => {
      const err = new Error(
        `Search bridge exited${code !== null ? ` with code ${code}` : ` with signal ${String(signal)}`}`,
      );
      if (code !== null && code !== 0) {
        for (const call of this.pending.values()) {
          call.reject(err);
        }
      }
      this.pending.clear();
      this.started = false;
    });

    this.proc.on("error", (err) => {
      for (const call of this.pending.values()) {
        call.reject(new Error(`Search bridge process error: ${(err as Error).message}`));
      }
      this.pending.clear();
      this.started = false;
    });
  }

  public async stop(): Promise<void> {
    if (!this.started || !this.proc) {
      return;
    }

    this.proc.kill();
    this.proc = undefined;
    this.started = false;
    for (const call of this.pending.values()) {
      call.reject(new Error("search bridge stopped"));
    }
    this.pending.clear();
  }

  private write(payload: RpcRequest<unknown>): void {
    if (!this.proc || !this.proc.stdin) {
      throw new Error("search bridge is not connected");
    }

    const ok = this.proc.stdin.write(formatRpcRequest(payload), "utf8");
    if (!ok) {
      this.proc.stdin.once("drain", () => {
        this.proc?.stdin?.write("");
      });
    }
  }

  private handleLine(line: string): void {
    let payload: RpcSuccess<unknown> | RpcFailure | RpcNotification<unknown> | null;
    try {
      payload = parseRpcLine(line);
    } catch {
      return;
    }

    if (!payload) {
      return;
    }

    if ("method" in payload) {
      if (payload.method === "ui.input" && payload.params && typeof payload.params === "object") {
        const event = payload.params as UiInputEvent;
        for (const subscriber of this.uiInputSubscribers) {
          subscriber(event);
        }
      }
      return;
    }

    const pending = this.pending.get(payload.id);
    if (!pending) {
      return;
    }

    this.pending.delete(payload.id);
    if (pending.timeoutHandle) {
      clearTimeout(pending.timeoutHandle);
    }

    if ("error" in payload) {
      pending.reject(new Error(`${payload.error.code}: ${payload.error.message}`));
      return;
    }

    pending.resolve(payload.result);
  }

  public onUiInput(listener: (event: UiInputEvent) => void): () => void {
    this.uiInputSubscribers.add(listener);
    return () => {
      this.uiInputSubscribers.delete(listener);
    };
  }

  public async call<T>(method: string, params: unknown = undefined): Promise<T> {
    await this.start();

    const id = this.nextRequestId++;
    const payload: RpcRequest<unknown> = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return await new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`search bridge timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, {
        resolve,
        reject,
        timeoutHandle,
      });

      try {
        this.write(payload);
      } catch (err) {
        clearTimeout(timeoutHandle);
        this.pending.delete(id);
        reject(err as Error);
      }
    }) as T;
  }

  public async uiUpdate(params: UiUpdateParams): Promise<UiUpdateResult> {
    return await this.call<UiUpdateResult>("ui.update", params);
  }
}
