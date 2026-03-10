import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { SearchBridge } from "../src/search/bridge";

const cleanup: string[] = [];
afterEach(async () => {
  while (cleanup.length) {
    const dir = cleanup.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pi-rpc-"));
  cleanup.push(root);
  await writeFile(path.join(root, "alpha.txt"), "searchable content\nline two", "utf8");
  await writeFile(path.join(root, "beta.ts"), "const term = 'searchable';", "utf8");
  await writeFile(path.join(root, ".gitignore"), "ignored\n", "utf8");
  await writeFile(path.join(root, "ignored"), "should not be indexed", "utf8");
  return root;
}

function zigBinaryPath(): string {
  const p = path.join(process.cwd(), "zig-out", "bin", process.platform === "win32" ? "pi-zig-search.exe" : "pi-zig-search");
  return p;
}

describe("Bun↔Zig JSON-RPC integration", () => {
  it("handles init/files/grep over persistent process", async () => {
    if (!existsSync(zigBinaryPath())) {
      console.warn("Skipping integration test: zig binary missing");
      return;
    }
    const root = await makeWorkspace();
    const bridge = new SearchBridge({ binaryPath: zigBinaryPath(), workspaceRoot: root, requestTimeoutMs: 4000 });

    const init = await bridge.call<{ ok: boolean; file_count: number }>("search.init", { root });
    expect(init.ok).toBeTrue();
    expect(init.file_count).toBeGreaterThan(0);

    const files = await bridge.call<{ total: number; results: Array<{ path: string }> }>("search.files", { query: "alpha", cwd: root, limit: 5 });
    expect(files.total).toBeGreaterThan(0);
    expect(files.results.some((r) => r.path.endsWith("alpha.txt"))).toBeTrue();

    const grep = await bridge.call<{ total: number; matches: Array<{ path: string }> }>("search.grep", { query: "searchable", cwd: root, limit: 5, caseInsensitive: true });
    expect(grep.total).toBeGreaterThan(0);

    await bridge.stop();
  });

  it("returns structured errors for unknown methods", async () => {
    if (!existsSync(zigBinaryPath())) {
      console.warn("Skipping integration test: zig binary missing");
      return;
    }
    const root = await makeWorkspace();
    const bridge = new SearchBridge({ binaryPath: zigBinaryPath(), workspaceRoot: root, requestTimeoutMs: 4000 });

    await expect(bridge.call("search.unknown", {})).rejects.toThrow("-32601");
    await bridge.stop();
  });

  it("supports concurrent requests on the same bridge", async () => {
    if (!existsSync(zigBinaryPath())) {
      console.warn("Skipping integration test: zig binary missing");
      return;
    }
    const root = await makeWorkspace();
    const bridge = new SearchBridge({ binaryPath: zigBinaryPath(), workspaceRoot: root, requestTimeoutMs: 4000 });

    await bridge.call("search.init", { root });

    const [a, b] = await Promise.all([
      bridge.call<{ total: number }>("search.files", { query: "alpha", cwd: root, limit: 5 }),
      bridge.call<{ total: number }>("search.files", { query: "beta", cwd: root, limit: 5 }),
    ]);

    expect(a.total).toBeGreaterThan(0);
    expect(b.total).toBeGreaterThan(0);
    await bridge.stop();
  });
});
