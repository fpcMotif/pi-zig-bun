import type { UiAck, UiInputParams, UiUpdateParams } from "../rpc/types";
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
  private proc?: ReturnType<typeof spawn>;
  private stdoutBuffer = "";
  private nextRequestId = 1;
  private pending = new Map<RpcId, PendingCall>();
  private started = false;

  private scrub(text: string): string {
    const paths = [
      { path: this.binaryPath, replacement: "[BINARY_PATH]" },
      { path: this.workspaceRoot, replacement: "[WORKSPACE_ROOT]" },
    ].sort((left, right) => right.path.length - left.path.length);

    let scrubbed = text;
    for (const { path, replacement } of paths) {
      if (path) {
        scrubbed = scrubbed.split(path).join(replacement);
      }
    }

    return scrubbed;
  }

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

    // keep last candidate for nicer errors while still allowing explicit override.
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

    // We shouldn't fail fatally if the root directory is wiped while bridge runs.
    // Ensure the directory exists initially.
    const piDir = path.join(this.workspaceRoot, ".pi");
    mkdirSync(piDir, { recursive: true });

    const stderrLog = path.join(piDir, "search-bridge.stderr.log");

    if (this.proc.stderr) {
      this.proc.stderr.on("data", (chunk) => {
        try {
          // Re-create the directory if it was deleted concurrently before logging.
          if (!existsSync(piDir)) {
            mkdirSync(piDir, { recursive: true });
          }
          appendFileSync(stderrLog, this.scrub(chunk.toString()));
        } catch {
          // ignore logging errors to prevent breaking the bridge
        }
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
      for (const call of this.pending.values()) {
        if (call.timeoutHandle) clearTimeout(call.timeoutHandle);
        call.reject(err);
      }
      this.pending.clear();
      this.started = false;
    });

    this.proc.on("error", (err) => {
      for (const call of this.pending.values()) {
        if (call.timeoutHandle) clearTimeout(call.timeoutHandle);
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

    const proc = this.proc;
    const closePromise = new Promise<void>((resolve) => {
      proc.once("close", () => resolve());
    });

    proc.kill();
    this.proc = undefined;
    this.started = false;
    for (const call of this.pending.values()) {
      if (call.timeoutHandle) clearTimeout(call.timeoutHandle);
      call.reject(new Error("search bridge stopped"));
    }
    this.pending.clear();
    await closePromise;
  }

  private write(payload: RpcRequest): void {
    if (!this.proc || !this.proc.stdin) {
      throw new Error("search bridge is not connected");
    }

    const line = `${JSON.stringify(payload)}\n`;
    this.proc.stdin.write(line, "utf8");
    // Backpressure is acceptable here: Node buffers the data internally
    // and flushes when the kernel is ready. No additional drain handling
    // needed for newline-delimited JSON-RPC over stdin.
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
        pending.reject(new Error(this.scrub(`${payload.error.code}: ${payload.error.message}`)));
      } else {
        pending.resolve(payload.result);
      }
    } catch {
      // Ignore malformed lines in non-protocol output.
    }
  }


  public async uiUpdate(params: UiUpdateParams): Promise<UiAck> {
    return this.call<UiAck>("ui.update", params);
  }

  public async uiInput(params: UiInputParams): Promise<UiAck> {
    return this.call<UiAck>("ui.input", params);
  }
  public async call<T>(method: string, params: unknown = undefined): Promise<T> {
    if (!this.started) {
      await this.start();
    }

    const id = this.nextRequestId++;
    const payload: RpcRequest = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };

    return (await new Promise<unknown>((resolve, reject) => {
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
    })) as T;
  }
}
