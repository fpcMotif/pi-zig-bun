import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

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

interface SearchProcess {
  stdin: Writable;
  stdout: Readable;
  stderr: Readable;
  kill: () => boolean;
  on: (event: string, listener: (...args: unknown[]) => void) => SearchProcess;
}

export interface SearchBridgeOptions {
  binaryPath?: string;
  workspaceRoot?: string;
  requestTimeoutMs?: number;
  spawnProcess?: (
    binaryPath: string,
    options: SpawnOptionsWithoutStdio,
  ) => SearchProcess;
}

export class SearchBridge {
  private readonly binaryPath: string;
  private readonly workspaceRoot: string;
  private readonly requestTimeoutMs: number;
  private readonly spawnProcess: (
    binaryPath: string,
    options: SpawnOptionsWithoutStdio,
  ) => SearchProcess;
  private proc?: SearchProcess;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<RpcId, PendingCall>();
  private started = false;
  private stopping = false;
  private crashed = false;
  private reconnectAttempts = 0;
  private startPromise?: Promise<void>;
  private static readonly RECONNECT_MAX_ATTEMPTS = 3;
  private static readonly RECONNECT_BASE_DELAY_MS = 100;

  constructor(options: SearchBridgeOptions = {}) {
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.binaryPath = this.resolveBinary(options.binaryPath);
    this.spawnProcess = options.spawnProcess ?? ((binaryPath, spawnOptions) => spawn(binaryPath, spawnOptions));
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

    // keep last candidate for nicer errors while still allowing explicit override.
    return candidates[0]!;
  }

  public async start(): Promise<void> {
    if (this.started || this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = this.startInternal();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = undefined;
    }
  }

  private async startInternal(): Promise<void> {
    if (!existsSync(this.binaryPath)) {
      throw new Error(
        [
          `Zig search binary missing: ${this.binaryPath}`,
          "Run `zig build` before starting pi-zig-bun.",
          "If you use a custom binary path, pass { binaryPath } when creating SearchBridge.",
        ].join(" "),
      );
    }

    this.stopping = false;
    this.proc = this.spawnProcess(this.binaryPath, {
      cwd: this.workspaceRoot,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    this.started = true;
    this.crashed = false;
    this.reconnectAttempts = 0;
    mkdirSync(path.join(this.workspaceRoot, ".pi"), { recursive: true });
    const stderrLog = path.join(this.workspaceRoot, ".pi", "search-bridge.stderr.log");

    this.proc.stderr.on("data", (chunk) => {
      appendFileSync(stderrLog, chunk);
    });

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
      this.proc = undefined;

      if (this.stopping) {
        return;
      }

      this.crashed = true;
      this.rejectPending(
        new Error(
          `Search bridge exited${code !== null ? ` with code ${code}` : ` with signal ${String(signal)}`}`,
        ),
      );
    });

    this.proc.on("error", (err) => {
      this.started = false;
      this.proc = undefined;
      this.crashed = true;
      this.rejectPending(new Error(`Search bridge process error: ${(err as Error).message}`));
    });
  }

  public async stop(): Promise<void> {
    if (!this.started || !this.proc) {
      return;
    }

    this.stopping = true;
    this.proc.kill();
    this.proc = undefined;
    this.started = false;
    this.crashed = false;
    this.reconnectAttempts = 0;
    this.rejectPending(new Error("search bridge stopped"));
  }

  private rejectPending(error: Error): void {
    for (const call of this.pending.values()) {
      if (call.timeoutHandle) {
        clearTimeout(call.timeoutHandle);
      }
      call.reject(error);
    }
    this.pending.clear();
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) {
      return;
    }

    if (this.crashed) {
      if (this.reconnectAttempts >= SearchBridge.RECONNECT_MAX_ATTEMPTS) {
        throw new Error(
          `search bridge reconnect failed after ${SearchBridge.RECONNECT_MAX_ATTEMPTS} attempts`,
        );
      }
      this.reconnectAttempts += 1;
      const delayMs = SearchBridge.RECONNECT_BASE_DELAY_MS * 2 ** (this.reconnectAttempts - 1);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    await this.start();
  }

  private write(payload: RpcRequest): void {
    if (!this.proc || !this.proc.stdin) {
      throw new Error("search bridge is not connected");
    }

    const line = `${JSON.stringify(payload)}\n`;
    const ok = this.proc.stdin.write(line, "utf8");
    if (!ok) {
      this.proc.stdin.once("drain", () => {
        this.proc?.stdin?.write("");
      });
    }
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
      if ("error" in payload) {
        if (pending.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
        pending.reject(new Error(`${payload.error.code}: ${payload.error.message}`));
      } else {
        if (pending.timeoutHandle) {
          clearTimeout(pending.timeoutHandle);
        }
        pending.resolve(payload.result);
      }
    } catch {
      // Ignore malformed lines in non-protocol output.
    }
  }

  public async call<T>(method: string, params: unknown = undefined): Promise<T> {
    await this.ensureStarted();

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
    }).then((value) => {
      const call = this.pending.get(id);
      if (call?.timeoutHandle) {
        clearTimeout(call.timeoutHandle);
      }
      this.pending.delete(id);
      return value as T;
    });
  }
}
