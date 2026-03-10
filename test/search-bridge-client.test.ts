import { afterEach, describe, expect, it } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SearchBridge } from "../src/search/bridge";
import { SearchClient } from "../src/search/client";

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) {
    const dir = cleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function createFakeRpcBinary(mode: "ok" | "error"): Promise<{ root: string; binaryPath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-bridge-"));
  cleanup.push(root);
  const binaryPath = path.join(root, "fake-rpc.js");
  const source = `#!/usr/bin/env bun
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  if (${JSON.stringify(mode)} === "error" && req.method === "search.files") {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, error: { code: -32603, message: "forced" } }));
    return;
  }
  const delay = req.method === "slow" ? 20 : 0;
  setTimeout(() => {
    console.log(JSON.stringify({ jsonrpc: "2.0", id: req.id, result: { method: req.method, params: req.params ?? null } }));
  }, delay);
});`;

  await writeFile(binaryPath, source, "utf8");
  await chmod(binaryPath, 0o755);
  return { root, binaryPath };
}

describe("SearchClient params", () => {
  it("maps defaults and forwards methods", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const bridge = {
      call: async (method: string, params: unknown) => {
        calls.push({ method, params });
        return { query: "q", total: 0, offset: 0, limit: 0, elapsedMs: 0, results: [], matches: [] };
      },
      stop: async () => {},
    };

    const client = new SearchClient(bridge as any, "/work");
    await client.ensureInitialized("/next");
    await client.searchFiles("needle", {});
    await client.grep("needle", {});

    expect(calls[0]?.method).toBe("search.init");
    expect(calls[1]?.method).toBe("search.files");
    expect(calls[2]?.method).toBe("search.grep");
    expect((calls[1]?.params as any).includeScores).toBeTrue();
    expect((calls[2]?.params as any).caseInsensitive).toBeTrue();
  });
});

describe("SearchBridge", () => {
  it("supports persistent process and concurrent calls", async () => {
    const { root, binaryPath } = await createFakeRpcBinary("ok");
    const bridge = new SearchBridge({ binaryPath, workspaceRoot: root, requestTimeoutMs: 1000 });

    const [one, two] = await Promise.all([
      bridge.call<{ method: string }>("fast", { n: 1 }),
      bridge.call<{ method: string }>("slow", { n: 2 }),
    ]);

    expect(one.method).toBe("fast");
    expect(two.method).toBe("slow");

    await bridge.stop();
  });

  it("propagates rpc errors", async () => {
    const { root, binaryPath } = await createFakeRpcBinary("error");
    const bridge = new SearchBridge({ binaryPath, workspaceRoot: root, requestTimeoutMs: 1000 });

    await expect(bridge.call("search.files", { query: "x" })).rejects.toThrow("-32603: forced");
    await bridge.stop();
  });
});
