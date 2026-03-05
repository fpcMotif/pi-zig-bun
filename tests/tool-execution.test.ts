import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
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
    expect(() => readTool.execute(makeCtx(tmpDir), {} as any)).toThrow("path");
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

    expect(() =>
      editTool.execute(makeCtx(tmpDir), { path: filePath } as any),
    ).toThrow("edit requires");
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
    expect(() => bashTool.execute(makeCtx(tmpDir), {} as any)).toThrow("bash requires");
  });
});

