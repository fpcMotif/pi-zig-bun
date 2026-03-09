import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

type RpcId = number;

type RpcRequest = {
  jsonrpc: "2.0";
  id: RpcId;
  method: string;
  params?: unknown;
};

type RpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
};

type RpcSuccess<T> = { jsonrpc: "2.0"; id: RpcId; result: T };
type RpcFailure = { jsonrpc: "2.0"; id: RpcId; error: { code: number; message: string } };
type RpcInboundNotification = { jsonrpc: "2.0"; method: string; params?: unknown; id?: never };

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

export class SearchBridge {
  private readonly binaryPath: string;
  private readonly workspaceRoot: string;
  private readonly requestTimeoutMs: number;
  private proc?: ReturnType<typeof spawn>;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<RpcId, PendingCall>();
  private started = false;
  private readonly notificationHandlers = new Map<string, Set<(params: unknown) => void>>();

  constructor(options: SearchBridgeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.binaryPath = this.resolveBinary(options.binaryPath);
  }

  private resolveBinary(explicit?: string): string {
    if (explicit) return explicit;
    const binaryName = process.platform === "win32" ? "pi-zig-search.exe" : "pi-zig-search";
    const candidates = [
      path.join(this.workspaceRoot, "zig-out", "bin", binaryName),
      path.join(process.cwd(), "zig-out", "bin", binaryName),
      path.join(process.cwd(), ".zig-cache", "o", "bin", binaryName),
    ];
    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
    return candidates[0]!;
  }

  public async start(): Promise<void> {
    if (this.started) return;
    if (!existsSync(this.binaryPath)) {
      throw new Error(`Zig search binary missing: ${this.binaryPath}. Run \`zig build\` first.`);
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
    this.proc.stderr?.on("data", (chunk) => appendFileSync(stderrLog, chunk));

    this.stdoutBuffer = "";
    this.proc.stdout.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString();
      while (true) {
        const newlineIndex = this.stdoutBuffer.indexOf("\n");
        if (newlineIndex === -1) break;
        const line = this.stdoutBuffer.slice(0, newlineIndex);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);
        this.handleLine(line);
      }
    });

    this.proc.on("close", (code, signal) => {
      const err = new Error(
        `Search bridge exited${code !== null ? ` with code ${code}` : ` with signal ${String(signal)}`}`,
      );
      for (const call of this.pending.values()) call.reject(err);
      this.pending.clear();
      this.started = false;
      this.proc = undefined;
    });

    this.proc.on("error", (err) => {
      for (const call of this.pending.values()) {
        call.reject(new Error(`Search bridge process error: ${(err as Error).message}`));
      }
      this.pending.clear();
      this.started = false;
      this.proc = undefined;
    });
  }

  public onNotification(method: string, handler: (params: unknown) => void): () => void {
    const handlers = this.notificationHandlers.get(method) ?? new Set();
    handlers.add(handler);
    this.notificationHandlers.set(method, handlers);
    return () => {
      const existing = this.notificationHandlers.get(method);
      if (!existing) return;
      existing.delete(handler);
      if (existing.size === 0) this.notificationHandlers.delete(method);
    };
  }

  public async stop(): Promise<void> {
    if (!this.started || !this.proc) return;
    this.proc.kill();
    this.proc = undefined;
    this.started = false;
    for (const call of this.pending.values()) call.reject(new Error("search bridge stopped"));
    this.pending.clear();
  }

  private write(payload: RpcRequest | RpcNotification): void {
    if (!this.proc?.stdin) throw new Error("search bridge is not connected");
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`, "utf8");
  }

  private dispatchNotification(payload: RpcInboundNotification): void {
    const handlers = this.notificationHandlers.get(payload.method);
    if (!handlers) return;
    for (const handler of handlers) handler(payload.params);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const payload = JSON.parse(trimmed) as RpcSuccess<unknown> | RpcFailure | RpcInboundNotification;
      if ("method" in payload && !("id" in payload)) {
        this.dispatchNotification(payload);
        return;
      }

      if (!("id" in payload) || typeof payload.id !== "number") return;
      const responseId = payload.id;
      const pending = this.pending.get(responseId);
      if (!pending) return;

      this.pending.delete(responseId);
      if (pending.timeoutHandle) clearTimeout(pending.timeoutHandle);

      if ("error" in payload) {
        pending.reject(new Error(`${payload.error.code}: ${payload.error.message}`));
      } else if ("result" in payload) {
        pending.resolve(payload.result);
      }
    } catch {
      // ignore malformed protocol lines
    }
  }

  public async call<T>(method: string, params: unknown = undefined): Promise<T> {
    await this.start();
    const id = this.nextRequestId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };

    return new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`search bridge timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, timeoutHandle });

      try {
        this.write(payload);
      } catch (err) {
        clearTimeout(timeoutHandle);
        this.pending.delete(id);
        reject(err as Error);
      }
    }) as Promise<T>;
  }

  public async notify(method: string, params: unknown = undefined): Promise<void> {
    await this.start();
    this.write({ jsonrpc: "2.0", method, ...(params === undefined ? {} : { params }) });
  }
}
