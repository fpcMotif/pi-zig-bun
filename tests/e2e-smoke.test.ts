import { describe, expect, test, mock, spyOn } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { usage } from "../src/cli";
import { run } from "../src/main";

async function makeWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-e2e-"));
  const binDir = path.join(root, "zig-out", "bin");
  await mkdir(binDir, { recursive: true });

  const binaryPath = path.join(binDir, "pi-zig-search");
  await writeFile(binaryPath, `#!/usr/bin/env node
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const method = req.method;
  const params = req.params ?? {};
  let result;
  if (method === "search.init") result = { ok: true };
  else if (method === "search.files") result = {
    query: params.query,
    total: 1,
    offset: params.offset ?? 0,
    limit: params.limit ?? 50,
    elapsedMs: 1,
    results: [{ path: "src/main.ts", score: 99, matchType: "exact", rank: 1 }],
  };
  else if (method === "search.grep") result = {
    query: params.query,
    total: 1,
    elapsedMs: 1,
    limit: params.limit ?? 100,
    matches: [{ path: "src/main.ts", line: 7, column: 0, score: 1, text: "needle line" }],
  };
  else result = { ok: true };
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: req.id, result }) + "\\n");
});
`);
  await chmod(binaryPath, 0o755);

  return {
    root,
    cleanup: async () => rm(root, { recursive: true, force: true }),
  };
}

async function runOrThrow(args: string[], workspaceRoot: string): Promise<number> {
  try {
    return await run(args);
  } catch (error) {
    const logPath = path.join(workspaceRoot, ".pi", "search-bridge.stderr.log");
    let stderrLog = "<no stderr log>";
    try {
      stderrLog = await readFile(logPath, "utf8");
    } catch {
      // ignore
    }
    throw new Error(`run(${args.join(" ")}) failed: ${(error as Error).message}\nbridge stderr:\n${stderrLog}`);
  }
}

describe("e2e smoke: search + grep + tree", () => {
  test("run() executes command flows against bridge", async () => {
    const ctx = await makeWorkspace();
    const logSpy = mock(() => {});
    const errSpy = mock(() => {});

    const originalLog = console.log;
    const originalErr = console.error;
    console.log = logSpy as typeof console.log;
    console.error = errSpy as typeof console.error;

    try {
      const searchCode = await runOrThrow(["--cwd", ctx.root, "search", "needle"], ctx.root);
      const grepCode = await runOrThrow(["--cwd", ctx.root, "grep", "needle"], ctx.root);
      const treeCode = await runOrThrow(["--cwd", ctx.root, "tree"], ctx.root);

      expect(searchCode).toBe(0);
      expect(grepCode).toBe(0);
      expect(treeCode).toBe(0);

      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain("src/main.ts");
      expect(output).toContain("needle line");
      expect(output).toContain("Session heads:");
      expect(errSpy.mock.calls.length).toBe(0);
    } finally {
      console.log = originalLog;
      console.error = originalErr;
      await ctx.cleanup();
    }
  });
});

describe("e2e smoke: help", () => {
  test("run(['--help']) prints usage and returns 0", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    try {
      const code = await run(["--help"]);
      expect(code).toBe(0);
      expect(logSpy).toHaveBeenCalled();

      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain(usage());
    } finally {
      logSpy.mockRestore();
    }
  });
});
