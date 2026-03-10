import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { SearchBridge } from "./bridge";

class FakeProc extends EventEmitter {
  public stdin = new PassThrough();
  public stdout = new PassThrough();
  public stderr = new PassThrough();
  public killed = false;

  public kill(): boolean {
    this.killed = true;
    this.emit("close", 0, null);
    return true;
  }
}

const bridgesToStop: SearchBridge[] = [];

afterEach(async () => {
  await Promise.all(bridgesToStop.map((bridge) => bridge.stop()));
  bridgesToStop.length = 0;
});

function createBridgeWithFakeSpawn(spawnImpl: () => FakeProc): { bridge: SearchBridge; procRef: { current?: FakeProc } } {
  const root = mkdtempSync(path.join(tmpdir(), "bridge-test-"));
  const binaryPath = path.join(root, "fake-binary");
  writeFileSync(binaryPath, "");
  const procRef: { current?: FakeProc } = {};

  const bridge = new SearchBridge({
    binaryPath,
    workspaceRoot: root,
    requestTimeoutMs: 80,
    spawnProcess: () => {
      const proc = spawnImpl();
      procRef.current = proc;
      return proc;
    },
  });
  bridgesToStop.push(bridge);
  return { bridge, procRef };
}

describe("SearchBridge", () => {
  test("keeps one process for sequential calls", async () => {
    let spawnCount = 0;
    const { bridge, procRef } = createBridgeWithFakeSpawn(() => {
      spawnCount += 1;
      const proc = new FakeProc();
      proc.stdin.on("data", (chunk) => {
        const request = JSON.parse(chunk.toString().trim()) as { id: number; method: string };
        proc.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: `${request.method}-ok` })}\n`);
      });
      return proc;
    });

    const first = await bridge.call<string>("first");
    const second = await bridge.call<string>("second");

    expect(first).toBe("first-ok");
    expect(second).toBe("second-ok");
    expect(spawnCount).toBe(1);
    expect(procRef.current?.killed).toBeFalse();
  });

  test("resolves concurrent requests by id", async () => {
    const { bridge, procRef } = createBridgeWithFakeSpawn(() => {
      const proc = new FakeProc();
      proc.stdin.on("data", (chunk) => {
        const request = JSON.parse(chunk.toString().trim()) as { id: number; method: string };
        if (request.method === "slow") {
          setTimeout(() => {
            proc.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "slow-done" })}\n`);
          }, 20);
          return;
        }

        proc.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "fast-done" })}\n`);
      });
      return proc;
    });

    const slowPromise = bridge.call<string>("slow");
    const fastPromise = bridge.call<string>("fast");
    const [slow, fast] = await Promise.all([slowPromise, fastPromise]);

    expect(slow).toBe("slow-done");
    expect(fast).toBe("fast-done");
    expect(procRef.current).toBeDefined();
  });

  test("times out a request and allows subsequent calls", async () => {
    const { bridge, procRef } = createBridgeWithFakeSpawn(() => {
      const proc = new FakeProc();
      proc.stdin.on("data", (chunk) => {
        const request = JSON.parse(chunk.toString().trim()) as { id: number; method: string };
        if (request.method === "never") {
          return;
        }

        proc.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "after-timeout" })}\n`);
      });
      return proc;
    });

    await expect(bridge.call("never")).rejects.toThrow("search bridge timed out");
    await expect(bridge.call<string>("works")).resolves.toBe("after-timeout");
    expect(procRef.current?.killed).toBeFalse();
  });
});
