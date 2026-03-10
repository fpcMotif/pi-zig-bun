import { once } from "node:events";
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

type RpcSuccess<T> = {
  jsonrpc: "2.0";
  id: RpcId;
  result: T;
};

type RpcFailure = {
  jsonrpc: "2.0";
  id: RpcId;
  error: { code: number; message: string };
};

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
  private readonly healthCheckTimeoutMs: number;
  private proc?: ReturnType<typeof spawn>;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<RpcId, PendingCall>();
  private started = false;
  private shuttingDown = false;
  private callQueue: Promise<void> = Promise.resolve();

  constructor(options: SearchBridgeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.healthCheckTimeoutMs = Math.max(250, Math.min(this.requestTimeoutMs, 2_000));
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
    this.shuttingDown = false;
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
      this.started = false;
      const err = new Error(
        `Search bridge exited${code !== null ? ` with code ${code}` : ` with signal ${String(signal)}`}`,
      );
      this.rejectAllPending(err);
      this.proc = undefined;
    });

    this.proc.on("error", (err) => {
      this.started = false;
      this.rejectAllPending(new Error(`Search bridge process error: ${(err as Error).message}`));
      this.proc = undefined;
    });
  }

  private rejectAllPending(error: Error): void {
    for (const [id, call] of this.pending.entries()) {
      if (call.timeoutHandle) {
        clearTimeout(call.timeoutHandle);
      }
      call.reject(error);
      this.pending.delete(id);
    }
  }

  public async stop(): Promise<void> {
    this.shuttingDown = true;

    if (!this.proc) {
      this.started = false;
      return;
    }

    const proc = this.proc;

    try {
      if (proc.stdin && !proc.stdin.destroyed) {
        const shutdownId = this.nextRequestId++;
        proc.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: shutdownId, method: "shutdown" })}\n`, "utf8");
      }
    } catch {
      // best effort only
    }

    proc.kill("SIGTERM");
    const closePromise = once(proc, "close").catch(() => undefined);
    const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 1_000));
    await Promise.race([closePromise, timeoutPromise]);

    if (this.started) {
      proc.kill("SIGKILL");
      await once(proc, "close").catch(() => undefined);
    }

    this.started = false;
    this.proc = undefined;
    this.rejectAllPending(new Error("search bridge stopped"));
  }

  private write(payload: RpcRequest): void {
    if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) {
      throw new Error("search bridge is not connected");
    }

    const line = `${JSON.stringify(payload)}\n`;
    this.proc.stdin.write(line, "utf8");
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const payload = JSON.parse(trimmed) as RpcSuccess<unknown> | RpcFailure;
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
      } else {
        pending.resolve(payload.result);
      }
    } catch {
      // Ignore malformed lines in non-protocol output.
    }
  }

  private enqueueCall<T>(task: () => Promise<T>): Promise<T> {
    const nextTask = this.callQueue.then(task, task);
    this.callQueue = nextTask.then(
      () => undefined,
      () => undefined,
    );
    return nextTask;
  }

  private async ensureHealthy(): Promise<void> {
    if (this.shuttingDown) {
      throw new Error("search bridge is shutting down");
    }

    if (!this.started || !this.proc || this.proc.killed) {
      await this.start();
      return;
    }

    try {
      await this.sendRequest("ping", undefined, this.healthCheckTimeoutMs);
    } catch {
      await this.restartProcess();
    }
  }

  private async restartProcess(): Promise<void> {
    await this.stop();
    this.shuttingDown = false;
    await this.start();
  }

  private async sendRequest<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    const id = this.nextRequestId++;
    const payload: RpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return await new Promise<unknown>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`search bridge timed out after ${timeoutMs}ms`));
      }, timeoutMs);

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

  public async call<T>(method: string, params: unknown = undefined): Promise<T> {
    return this.enqueueCall(async () => {
      await this.ensureHealthy();

      try {
        return await this.sendRequest<T>(method, params, this.requestTimeoutMs);
      } catch (error) {
        if (this.shuttingDown) {
          throw error;
        }

        await this.restartProcess();
        return await this.sendRequest<T>(method, params, this.requestTimeoutMs);
      }
    });
  }
}
