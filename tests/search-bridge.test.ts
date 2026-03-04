import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, chmod } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { SearchBridge } from "../src/search/bridge";

async function createFakeBridgeBinary(mode: "ok" | "timeout" | "crash"): Promise<{ root: string; binaryPath: string }> {
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
  if (mode === "timeout") {
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
    const bridge = new SearchBridge({ binaryPath: crashFixture.binaryPath, workspaceRoot: crashFixture.root, requestTimeoutMs: 100 });
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
      const recovered = new SearchBridge({ binaryPath: okFixture.binaryPath, workspaceRoot: okFixture.root, requestTimeoutMs: 100 });
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
});
