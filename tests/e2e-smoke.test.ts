import { describe, expect, test, mock } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { run } from "../src/main";

async function makeWorkspace() {
  const root = await mkdtemp(path.join(tmpdir(), "pi-e2e-"));
  const binDir = path.join(root, "zig-out", "bin");
  await mkdir(binDir, { recursive: true });

  const binaryPath = path.join(binDir, "pi-zig-search");
  await writeFile(binaryPath, `#!/usr/bin/env node
import { realpathSync } from "node:fs";
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const req = JSON.parse(line);
  const method = req.method;
  const params = req.params ?? {};
  const requestedCwd = typeof params.cwd === "string" ? realpathSync(params.cwd) : realpathSync(process.cwd());
  const inWorkspace = requestedCwd === realpathSync(process.cwd());
  let result;
  if (method === "search.init") result = { ok: true, elapsed_ms: 1 };
  else if (method === "search.files") result = {
    query: params.query,
    total: inWorkspace ? 1 : 0,
    offset: params.offset ?? 0,
    limit: params.limit ?? 50,
    elapsed_ms: 1,
    results: inWorkspace ? [{ path: "src/main.ts", score: 99, match_type: "exact", rank: 1 }] : [],
  };
  else if (method === "search.grep") result = {
    query: params.query,
    total: inWorkspace ? 1 : 0,
    elapsed_ms: 1,
    limit: params.limit ?? 100,
    matches: inWorkspace ? [{ path: "src/main.ts", line: 7, column: 0, score: 1, text: "needle line" }] : [],
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
    const logSpy = mock((msg?: string) => {});
    const errSpy = mock(() => {});

    const originalLog = console.log;
    const originalErr = console.error;
    const originalStdoutWrite = process.stdout.write;
    console.log = logSpy as typeof console.log;
    console.error = errSpy as typeof console.error;
    process.stdout.write = ((msg: string) => { logSpy(msg.replace(/\n$/, '')); return true; }) as any;

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
      process.stdout.write = originalStdoutWrite;
      await ctx.cleanup();
    }
  });

  test("run() returns stable session and login responses", async () => {
    const ctx = await makeWorkspace();
    const logSpy = mock((msg?: string) => {});
    const errSpy = mock(() => {});

    const originalLog = console.log;
    const originalErr = console.error;
    const originalStdoutWrite = process.stdout.write;
    console.log = logSpy as typeof console.log;
    console.error = errSpy as typeof console.error;
    process.stdout.write = ((msg: string) => { logSpy(msg.replace(/\n$/, '')); return true; }) as any;

    try {
      const sessionUsageCode = await runOrThrow(["--cwd", ctx.root, "session"], ctx.root);
      const sessionMissingCode = await runOrThrow(["--cwd", ctx.root, "session", "--root-session", "missing"], ctx.root);
      const loginCode = await runOrThrow(["--cwd", ctx.root, "--json", "/login"], ctx.root);

      expect(sessionUsageCode).toBe(1);
      expect(sessionMissingCode).toBe(1);
      expect(loginCode).toBe(0);

      const output = logSpy.mock.calls.flat().join("\n");
      expect(output).toContain("Session subcommand usage: session --root-session <id>");
      expect(output).toContain("Session not found: missing");
      expect(output).toContain('"code":"NOT_SUPPORTED"');
      expect(errSpy.mock.calls.length).toBe(0);
    } finally {
      console.log = originalLog;
      console.error = originalErr;
      await ctx.cleanup();
    }
  });
});
