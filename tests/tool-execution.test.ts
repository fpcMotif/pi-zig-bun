import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { readTool, writeTool, editTool, bashTool } from "../src/tools/builtin";
import { MemoryToolRegistry, type Tool } from "../src/tools/types";
import type { ToolExecutionContext } from "../src/tools/types";
import { CapabilityManager } from "../src/permissions";
import type { ToolResult } from "../src/permissions";

// ---------------------------------------------------------------------------
// Temp workspace lifecycle
// ---------------------------------------------------------------------------
let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "pi-tool-test-"));
}

function makeCtx(
  cwd: string,
  capabilities: CapabilityManager = (() => {
    const m = new CapabilityManager();
    m.allowAll();
    return m;
  })(),
): ToolExecutionContext {
  return {
    id: crypto.randomUUID(),
    cwd,
    capabilities: {
      require: (cap, target) => capabilities.require(cap, target),
    },
  };
}

// ---------------------------------------------------------------------------
// readTool
// ---------------------------------------------------------------------------
describe("readTool", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("reads a valid UTF-8 file and returns its content", async () => {
    const filePath = path.join(tmpDir, "hello.txt");
    await writeFile(filePath, "hello world");

    const result = (await readTool.execute(makeCtx(tmpDir), { path: filePath })) as ToolResult;

    expect(result.ok).toBe(true);
    expect(result.output).toBe("hello world");
    expect((result.data as { bytes: number }).bytes).toBe(11);
  });

  test("returns error for files exceeding the 500 KB size guard", async () => {
    const filePath = path.join(tmpDir, "large.bin");
    // Write a file slightly larger than 500 000 bytes
    const oversized = Buffer.alloc(500_001, 0x41);
    await writeFile(filePath, oversized);

    const result = (await readTool.execute(makeCtx(tmpDir), { path: filePath })) as ToolResult;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("file too large");
  });

  test("throws when the path argument is missing", async () => {
    await expect(readTool.execute(makeCtx(tmpDir), {} as any)).rejects.toThrow("path");
  });

  test("rejects blank path values", async () => {
    await expect(readTool.execute(makeCtx(tmpDir), { path: "   " } as any)).rejects.toThrow("path must not be empty");
  });

  test("rejects relative path traversal outside cwd", async () => {
    await expect(readTool.execute(makeCtx(tmpDir), { path: "../../../etc/passwd" })).rejects.toThrow("Path traversal detected");
  });

  test("rejects absolute path traversal outside cwd", async () => {
    await expect(readTool.execute(makeCtx(tmpDir), { path: "/etc/passwd" })).rejects.toThrow("Path traversal detected");
  });

  test("rejects existing file reached via symlink escape", async () => {
    const escapedWorkspace = await mkdtemp(path.join(os.tmpdir(), "pi-tool-escape-read-"));
    const escapedRoot = path.join(escapedWorkspace, "outside");
    await mkdir(escapedRoot, { recursive: true });
    const escapedFile = path.join(escapedRoot, "secret.txt");
    await writeFile(escapedFile, "secret");
    const linkPath = path.join(tmpDir, "workspace-link");
    await symlink(escapedRoot, linkPath, "dir");

    try {
      await expect(
        readTool.execute(makeCtx(tmpDir), { path: path.join(linkPath, "secret.txt") }),
      ).rejects.toThrow("Path traversal detected (symlink escape)");
    } finally {
      await rm(escapedWorkspace, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// writeTool
// ---------------------------------------------------------------------------
describe("writeTool", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("creates a new file with the provided content", async () => {
    const filePath = path.join(tmpDir, "out.txt");
    const result = (await writeTool.execute(makeCtx(tmpDir), {
      path: filePath,
      content: "new content",
    })) as ToolResult;

    expect(result.ok).toBe(true);
    expect(result.output).toContain(filePath);

    const ondisk = await readFile(filePath, "utf8");
    expect(ondisk).toBe("new content");
  });

  test("creates intermediate directories if they do not exist", async () => {
    const filePath = path.join(tmpDir, "a", "b", "c", "deep.txt");
    const result = (await writeTool.execute(makeCtx(tmpDir), {
      path: filePath,
      content: "deep",
    })) as ToolResult;

    expect(result.ok).toBe(true);
    const ondisk = await readFile(filePath, "utf8");
    expect(ondisk).toBe("deep");
  });

  test("does not overwrite an existing file when overwrite is false", async () => {
    const filePath = path.join(tmpDir, "existing.txt");
    await writeFile(filePath, "original");

    const result = (await writeTool.execute(makeCtx(tmpDir), {
      path: filePath,
      content: "replacement",
      overwrite: false,
    })) as ToolResult;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("file already exists");
    expect(await readFile(filePath, "utf8")).toBe("original");
  });

  test("rejects non-boolean overwrite flags", async () => {
    await expect(
      writeTool.execute(makeCtx(tmpDir), {
        path: path.join(tmpDir, "out.txt"),
        content: "hello",
        overwrite: "false" as any,
      }),
    ).rejects.toThrow("overwrite must be a boolean");
  });

  test("rejects writes outside cwd", async () => {
    await expect(writeTool.execute(makeCtx(tmpDir), {
      path: "../../../etc/passwd",
      content: "hacked",
    })).rejects.toThrow("Path traversal detected");

    await expect(writeTool.execute(makeCtx(tmpDir), {
      path: "/etc/passwd",
      content: "hacked",
    })).rejects.toThrow("Path traversal detected");
  });

  test("rejects new writes through symlink escape", async () => {
    const escapedWorkspace = await mkdtemp(path.join(os.tmpdir(), "pi-tool-escape-write-"));
    const escapedRoot = path.join(escapedWorkspace, "outside");
    await mkdir(escapedRoot, { recursive: true });
    const linkPath = path.join(tmpDir, "workspace-link");
    await symlink(escapedRoot, linkPath, "dir");

    await expect(
      writeTool.execute(makeCtx(tmpDir), {
        path: path.join(linkPath, "new.txt"),
        content: "nope",
      }),
    ).rejects.toThrow("Path traversal detected (symlink escape)");

    await rm(escapedWorkspace, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// editTool
// ---------------------------------------------------------------------------
describe("editTool", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("replaces all occurrences of the target text (replaceAll behaviour)", async () => {
    const filePath = path.join(tmpDir, "multi.txt");
    await writeFile(filePath, "aaa bbb aaa ccc aaa");

    const result = (await editTool.execute(makeCtx(tmpDir), {
      path: filePath,
      from: "aaa",
      to: "XXX",
    })) as ToolResult;

    expect(result.ok).toBe(true);

    const ondisk = await readFile(filePath, "utf8");
    expect(ondisk).toBe("XXX bbb XXX ccc XXX");
  });

  test("returns an error when the target text is not found", async () => {
    const filePath = path.join(tmpDir, "stable.txt");
    await writeFile(filePath, "unchanged content");

    const result = (await editTool.execute(makeCtx(tmpDir), {
      path: filePath,
      from: "NONEXISTENT",
      to: "something",
    })) as ToolResult;

    expect(result.ok).toBe(false);
    expect(result.error).toBe("target text not found");

    // File should remain untouched
    const ondisk = await readFile(filePath, "utf8");
    expect(ondisk).toBe("unchanged content");
  });

  test("throws when from or to fields are missing", async () => {
    const filePath = path.join(tmpDir, "dummy.txt");
    await writeFile(filePath, "content");

    await expect(editTool.execute(makeCtx(tmpDir), { path: filePath } as any)).rejects.toThrow("from");
  });

  test("rejects an empty replacement source string", async () => {
    const filePath = path.join(tmpDir, "empty-from.txt");
    await writeFile(filePath, "content");

    await expect(
      editTool.execute(makeCtx(tmpDir), { path: filePath, from: "", to: "x" }),
    ).rejects.toThrow("from must not be empty");

    expect(await readFile(filePath, "utf8")).toBe("content");
  });

  test("rejects edits outside cwd", async () => {
    await expect(editTool.execute(makeCtx(tmpDir), {
      path: "../../../etc/passwd",
      from: "a",
      to: "b",
    })).rejects.toThrow("Path traversal detected");

    await expect(editTool.execute(makeCtx(tmpDir), {
      path: "/etc/passwd",
      from: "a",
      to: "b",
    })).rejects.toThrow("Path traversal detected");

    const escapedWorkspace = await mkdtemp(path.join(os.tmpdir(), "pi-tool-escape-edit-"));
    const escapedRoot = path.join(escapedWorkspace, "outside");
    await mkdir(escapedRoot, { recursive: true });
    const escapedFile = path.join(escapedRoot, "file.txt");
    await writeFile(escapedFile, "before");
    const linkPath = path.join(tmpDir, "workspace-link");
    await symlink(escapedRoot, linkPath, "dir");

    await expect(
      editTool.execute(makeCtx(tmpDir), {
        path: path.join(linkPath, "file.txt"),
        from: "before",
        to: "after",
      }),
    ).rejects.toThrow("Path traversal detected (symlink escape)");

    const contents = await readFile(escapedFile, "utf8");
    expect(contents).toBe("before");
    await rm(escapedWorkspace, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// bashTool
// ---------------------------------------------------------------------------
describe("bashTool", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("executes a shell command and returns stdout", async () => {
    const result = (await bashTool.execute(makeCtx(tmpDir), {
      command: "echo hello",
    })) as ToolResult;

    expect(result.ok).toBe(true);
    expect(result.output!.trim()).toBe("hello");
  });

  test("filters out sensitive environment variables", async () => {
    process.env.TEST_API_KEY = "secret123";
    process.env.SAFE_VAR = "public456";
    const result = (await bashTool.execute(makeCtx(tmpDir), {
      command: "if [[ -n ${TEST_API_KEY-} ]]; then printf 'TEST_API_KEY=%s\\n' \"$TEST_API_KEY\"; fi; if [[ -n ${SAFE_VAR-} ]]; then printf 'SAFE_VAR=%s\\n' \"$SAFE_VAR\"; fi",
    })) as ToolResult;

    expect(result.ok).toBe(true);
    expect(result.output).not.toContain("TEST_API_KEY");
    expect(result.output).not.toContain("secret123");
    expect(result.output).toContain("SAFE_VAR=public456");

    delete process.env.TEST_API_KEY;
    delete process.env.SAFE_VAR;
  });

  test("executes within the context cwd", async () => {
    const result = (await bashTool.execute(makeCtx(tmpDir), {
      command: "pwd",
    })) as ToolResult;

    expect(result.ok).toBe(true);
    // On macOS, /tmp is a symlink to /private/tmp. The `pwd` command resolves
    // through the symlink, so we use realpath to normalise both sides.
    const { realpathSync } = await import("node:fs");
    const expected = realpathSync(tmpDir);
    expect(result.output!.trim()).toBe(expected);
  });

  test("throws when the command field is missing", async () => {
    await expect(bashTool.execute(makeCtx(tmpDir), {} as any)).rejects.toThrow("command");
  });

  test("rejects blank commands", async () => {
    await expect(bashTool.execute(makeCtx(tmpDir), { command: "   " } as any)).rejects.toThrow("command must not be empty");
  });

  test("prevents excessive bash output from exhausting memory", async () => {
    const result = (await bashTool.execute(makeCtx(tmpDir), {
      command: "for ((i=0;i<200000;i++)); do printf '0123456789012345678901234567890123456789\\n'; done",
    })) as ToolResult;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("bash execution failed");
  });

  test("returns structured failure for non-zero exit status", async () => {
    const result = (await bashTool.execute(makeCtx(tmpDir), {
      command: "echo nope >&2; exit 7",
    })) as ToolResult;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("nope");
    expect(result.output).toBe("");
    expect((result.data as { exitCode: number }).exitCode).toBe(7);
  });

  test("returns structured failure when spawning bash fails", async () => {
    await rm(tmpDir, { recursive: true, force: true });
    const result = (await bashTool.execute(makeCtx(tmpDir), {
      command: "echo hello",
    })) as ToolResult;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("bash execution failed");
  });
});

// ---------------------------------------------------------------------------
// MemoryToolRegistry
// ---------------------------------------------------------------------------
describe("MemoryToolRegistry", () => {
  beforeEach(async () => {
    tmpDir = await makeTmpDir();
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("registers tools and lists them", () => {
    const registry = new MemoryToolRegistry();
    registry.register(readTool as Tool);
    registry.register(writeTool as Tool);

    const tools = registry.list();
    expect(tools.map((t) => t.id).sort()).toEqual(["read", "write"]);
  });

  test("run() executes a registered tool and returns its result", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(writeTool as Tool);

    const filePath = path.join(tmpDir, "registry-test.txt");
    const result = await registry.run<ToolResult>(
      "write",
      { path: filePath, content: "via registry" },
      makeCtx(tmpDir),
    );
    expect(result.ok).toBe(true);

    const ondisk = await readFile(filePath, "utf8");
    expect(ondisk).toBe("via registry");
  });

  test("run() throws for an unregistered tool id", async () => {
    const registry = new MemoryToolRegistry();

    await expect(
      registry.run("nonexistent", {}, makeCtx(tmpDir)),
    ).rejects.toThrow("Tool not found: nonexistent");
  });

  test("run() enforces capability checks before executing the tool", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(readTool as Tool);

    // Create a capability manager that denies fs.read
    const restrictedManager = new CapabilityManager({});
    const ctx = makeCtx(tmpDir, restrictedManager);

    const filePath = path.join(tmpDir, "secret.txt");
    await writeFile(filePath, "classified");

    await expect(
      registry.run("read", { path: filePath }, ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() uses tool-resolved capability targets instead of raw input paths", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(readTool as Tool);

    const allowedDir = path.join(tmpDir, "allowed");
    await mkdir(allowedDir, { recursive: true });
    const allowedFile = path.join(allowedDir, "ok.txt");
    await writeFile(allowedFile, "visible");

    const scopedManager = new CapabilityManager({
      "fs.read": ["allowed/**"],
    });

    const ctx = makeCtx(tmpDir, scopedManager);

    const result = await registry.run<ToolResult>("read", { path: allowedFile }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toBe("visible");

    const forbiddenFile = path.join(tmpDir, "forbidden.txt");
    await writeFile(forbiddenFile, "nope");

    await expect(
      registry.run("read", { path: forbiddenFile }, ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() rejects capability resolvers that return undeclared capabilities", async () => {
    const registry = new MemoryToolRegistry();
    registry.register({
      id: "bad-tool",
      name: "bad-tool",
      description: "bad capability resolver",
      capabilities: ["fs.read"],
      resolveCapabilityTargets: () => [{ capability: "fs.write", target: "tmp/file.txt" }],
      execute: () => ({ ok: true }),
    });

    await expect(registry.run("bad-tool", {}, makeCtx(tmpDir))).rejects.toThrow("undeclared capability");
  });

  test("run() rejects capability resolvers that omit a declared capability", async () => {
    const registry = new MemoryToolRegistry();
    registry.register({
      id: "missing-capability-tool",
      name: "missing-capability-tool",
      description: "missing capability resolver",
      capabilities: ["fs.read", "fs.write"],
      resolveCapabilityTargets: () => [{ capability: "fs.read", target: "tmp/file.txt" }],
      execute: () => ({ ok: true }),
    });

    await expect(registry.run("missing-capability-tool", {}, makeCtx(tmpDir))).rejects.toThrow("did not resolve required capability");
  });
});
