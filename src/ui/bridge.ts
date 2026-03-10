import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

type RpcId = number;

type RpcRequest = { jsonrpc: "2.0"; id: RpcId; method: string; params?: unknown };
type RpcNotification = { jsonrpc: "2.0"; method: string; params?: unknown };
type RpcSuccess<T> = { jsonrpc: "2.0"; id: RpcId; result: T };
type RpcFailure = { jsonrpc: "2.0"; id: RpcId; error: { code: number; message: string; data?: unknown } };

type InputEvent = {
  event_type: "enter" | "text";
  text: string;
  received_ms: number;
};

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export class JsonRpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = "JsonRpcError";
  }
}

export class UIBridge {
  private proc?: ReturnType<typeof spawn>;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<RpcId, PendingCall>();
  private listeners = new Set<(event: InputEvent) => void>();

  constructor(
    private readonly workspaceRoot: string,
    private readonly binaryPath: string = UIBridge.resolveBinary(workspaceRoot),
  ) {}

  public static resolveBinary(workspaceRoot: string): string {
    const binaryName = process.platform === "win32" ? "pi-zig-search.exe" : "pi-zig-search";
    return path.join(workspaceRoot, "zig-out", "bin", binaryName);
  }

  public async start(): Promise<void> {
    if (this.proc) return;
    if (!existsSync(this.binaryPath)) {
      throw new Error(`Zig bridge binary missing: ${this.binaryPath}. Run \`zig build\`.`);
    }

    this.proc = spawn(this.binaryPath, {
      cwd: this.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc.stdout?.on("data", (chunk) => {
      this.stdoutBuffer += chunk.toString();
      while (true) {
        const idx = this.stdoutBuffer.indexOf("\n");
        if (idx < 0) break;
        const line = this.stdoutBuffer.slice(0, idx);
        this.stdoutBuffer = this.stdoutBuffer.slice(idx + 1);
        this.handleLine(line);
      }
    });

    this.proc.on("close", () => {
      const err = new Error("ui bridge exited unexpectedly");
      for (const call of this.pending.values()) call.reject(err);
      this.pending.clear();
      this.proc = undefined;
    });
  }

  public async stop(): Promise<void> {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = undefined;
  }

  public onInput(listener: (event: InputEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public async update(view: string): Promise<{ ok: boolean; view: string; queued_inputs: number }> {
    return this.call("ui.update", { view });
  }

  public async sendInput(event: { type: "enter" | "text"; text?: string }): Promise<{ ok: boolean }> {
    return this.call("ui.input", { type: event.type, text: event.text ?? "" });
  }

  public async call<T>(method: string, params: unknown = undefined): Promise<T> {
    await this.start();
    const id = this.nextRequestId++;
    const payload: RpcRequest = { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };

    return await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc?.stdin?.write(`${JSON.stringify(payload)}\n`, "utf8", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    }) as T;
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let payload: RpcSuccess<unknown> | RpcFailure | RpcNotification;
    try {
      payload = JSON.parse(trimmed);
    } catch {
      return;
    }

    if ("method" in payload && payload.method === "ui.input") {
      const params = payload.params as InputEvent;
      for (const listener of this.listeners) {
        listener(params);
      }
      return;
    }

    if (!("id" in payload)) return;

    const pending = this.pending.get(payload.id);
    if (!pending) return;
    this.pending.delete(payload.id);

    if ("error" in payload) {
      pending.reject(new JsonRpcError(payload.error.code, payload.error.message, payload.error.data));
      return;
    }

    pending.resolve(payload.result);
  }
}
