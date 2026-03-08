import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SearchBridge } from "../src/search/bridge";
import type { UiInputParams, UiUpdateParams } from "../src/rpc/types";

async function createFakeBridgeBinary(mode: "ok" | "timeout" | "crash" | "stderr" | "malformed" | "rpc_error"): Promise<{ root: string; binaryPath: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi-bridge-"));
  const binaryPath = path.join(root, "fake-bridge.mjs");
  const script = `#!/usr/bin/env node
import readline from "node:readline";
const mode = ${JSON.stringify(mode)};
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  if (mode === "crash") {
    process.exit(7);
  }
  if (mode === "stderr") {
    process.stderr.write("some error output\\n");
  }
  if (mode === "timeout") {
    return;
  }
  if (mode === "malformed") {
    process.stdout.write("not json\\n");
    // Fallthrough to write actual result so we can test it ignored the malformed line
  }
  if (mode === "rpc_error") {
    const errorPayload = JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32600, message: "Invalid Request" } });
    process.stdout.write(errorPayload + "\\n");
    return;
  }
  const payload = JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { method: req.method, echoed: req.params ?? null } });
  process.stdout.write(payload.slice(0, Math.floor(payload.length / 2)));
  setTimeout(() => process.stdout.write(payload.slice(Math.floor(payload.length / 2)) + "\\n"), 5);
});
`;
  await writeFile(binaryPath, script, "utf8");
  await chmod(binaryPath, 0o755);
  return { root, binaryPath };
}

describe("SearchBridge protocol behavior", () => {
  test("handles framed JSON-RPC responses", async () => {
    const fixture = await createFakeBridgeBinary("ok");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      const response = await bridge.call<{ method: string }>("search.files", { query: "abc" });
      expect(response.method).toBe("search.files");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("times out long-running requests", async () => {
    const fixture = await createFakeBridgeBinary("timeout");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 20 });
    try {
      await expect(bridge.call("search.files", { query: "abc" })).rejects.toThrow("timed out");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("recovers after process crash on next call", async () => {
    const crashFixture = await createFakeBridgeBinary("crash");
    const okFixture = await createFakeBridgeBinary("ok");
    const bridge = new SearchBridge({ binaryPath: crashFixture.binaryPath, workspaceRoot: crashFixture.root, requestTimeoutMs: 200 });
    try {
      let crashed = false;
      try {
        await bridge.call("search.files", { query: "abc" });
      } catch (error) {
        crashed = true;
        expect(String((error as Error).message)).toMatch(/exited|stopped|error|timed out/);
      }
      expect(crashed).toBe(true);
      await bridge.stop();
      const recovered = new SearchBridge({ binaryPath: okFixture.binaryPath, workspaceRoot: okFixture.root, requestTimeoutMs: 200 });
      try {
        const response = await recovered.call<{ method: string }>("search.grep", { query: "abc" });
        expect(response.method).toBe("search.grep");
      } finally {
        await recovered.stop();
      }
    } finally {
      await rm(crashFixture.root, { recursive: true, force: true });
      await rm(okFixture.root, { recursive: true, force: true });
    }
  });

  test("enforces single-flight by rejecting interrupted concurrent call", async () => {
    const fixture = await createFakeBridgeBinary("timeout");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      const first = bridge.call("search.files", { query: "a" });
      const second = bridge.call("search.files", { query: "b" });
      const results = await Promise.allSettled([first, second]);
      expect(results.some((item) => item.status === "rejected")).toBe(true);
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("logs stderr output to .pi/search-bridge.stderr.log", async () => {
    const fixture = await createFakeBridgeBinary("stderr");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      await bridge.call("search.files", { query: "abc" });

      // Wait a tiny bit for the async write to complete
      await new Promise(resolve => setTimeout(resolve, 10));

      const { readFile } = await import("node:fs/promises");
      const logContent = await readFile(path.join(fixture.root, ".pi", "search-bridge.stderr.log"), "utf8");
      expect(logContent).toContain("some error output");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("ignores malformed json on stdout", async () => {
    const fixture = await createFakeBridgeBinary("malformed");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      const response = await bridge.call<{ method: string }>("search.files", { query: "abc" });
      expect(response.method).toBe("search.files");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects call when rpc returns error", async () => {
    const fixture = await createFakeBridgeBinary("rpc_error");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      await expect(bridge.call("search.files", { query: "abc" })).rejects.toThrow("-32600: Invalid Request");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("rejects call on child process error", async () => {
    const fixture = await createFakeBridgeBinary("ok");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      const callPromise = bridge.call("search.files", { query: "abc" });

      // Wait a tick so the process is spawned, then manually emit an error
      await new Promise(resolve => setTimeout(resolve, 10));
      // @ts-ignore - access private field for testing
      bridge.proc.emit("error", new Error("simulated spawn error"));

      await expect(callPromise).rejects.toThrow("simulated spawn error");
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("uiUpdate wrapper calls ui.update", async () => {
    const fixture = await createFakeBridgeBinary("ok");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      const params: UiUpdateParams = {
        turnId: "turn-1",
        kind: "status",
        message: "progress",
        meta: { progress: 0.5 },
      };
      const response = await bridge.uiUpdate(params);
      // @ts-ignore - testing the echoed result
      expect(response.method).toBe("ui.update");
      // @ts-ignore
      expect(response.echoed).toEqual(params);
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  test("uiInput wrapper calls ui.input", async () => {
    const fixture = await createFakeBridgeBinary("ok");
    const bridge = new SearchBridge({ binaryPath: fixture.binaryPath, workspaceRoot: fixture.root, requestTimeoutMs: 200 });
    try {
      const params: UiInputParams = {
        turnId: "turn-1",
        text: "testing",
        metadata: { source: "test" },
      };
      const response = await bridge.uiInput(params);
      // @ts-ignore - testing the echoed result
      expect(response.method).toBe("ui.input");
      // @ts-ignore
      expect(response.echoed).toEqual(params);
    } finally {
      await bridge.stop();
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
