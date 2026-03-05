import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { MemoryToolRegistry, type Tool, type ToolExecutionContext } from "../src/tools/types";
import { CapabilityManager } from "../src/permissions";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let tmpDir: string;

async function makeTmpDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "pi-tool-types-test-"));
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
      require: (cap, target) => {
        // Mock checking functionality
        capabilities.require(cap, target);
      },
    },
  };
}

const mockTool: Tool = {
  id: "mock",
  name: "Mock Tool",
  description: "A mock tool",
  capabilities: ["fs.read", "fs.write"],
  execute: async (ctx, input) => {
    return { ok: true, output: "mock output" };
  },
};

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
    registry.register(mockTool);

    const tools = registry.list();
    expect(tools.map((t) => t.id).sort()).toEqual(["mock"]);
  });

  test("run() executes a registered tool and returns its result", async () => {
    const registry = new MemoryToolRegistry();
    const toolWithoutFileDeps: Tool = {
      id: "mock_no_file",
      name: "Mock Tool",
      description: "A mock tool without file deps",
      capabilities: ["session.access"],
      execute: async (ctx, input) => {
        return { ok: true, output: "mock output" };
      },
    };
    registry.register(toolWithoutFileDeps);

    const result = await registry.run<{ ok: boolean; output: string }>(
      "mock_no_file",
      {},
      makeCtx(tmpDir),
    );
    expect(result.ok).toBe(true);
    expect(result.output).toBe("mock output");
  });

  test("run() throws for an unregistered tool id", async () => {
    const registry = new MemoryToolRegistry();

    expect(
      registry.run("nonexistent", {}, makeCtx(tmpDir)),
    ).rejects.toThrow("Tool not found: nonexistent");
  });

  test("run() enforces capability checks before executing the tool (valid path)", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(mockTool);

    // Create a capability manager that denies fs.read
    const restrictedManager = new CapabilityManager({});
    const ctx = makeCtx(tmpDir, restrictedManager);

    const filePath = path.join(tmpDir, "secret.txt");

    expect(
      registry.run("mock", { path: filePath }, ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() enforces capability checks before executing the tool (input string)", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(mockTool);

    // Create a capability manager that denies fs.read
    const restrictedManager = new CapabilityManager({});
    const ctx = makeCtx(tmpDir, restrictedManager);

    expect(
      registry.run("mock", "string input", ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() enforces capability checks before executing the tool (input null)", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(mockTool);

    // Create a capability manager that denies fs.read
    const restrictedManager = new CapabilityManager({});
    const ctx = makeCtx(tmpDir, restrictedManager);

    expect(
      registry.run("mock", null, ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() enforces capability checks before executing the tool (input undefined)", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(mockTool);

    // Create a capability manager that denies fs.read
    const restrictedManager = new CapabilityManager({});
    const ctx = makeCtx(tmpDir, restrictedManager);

    expect(
      registry.run("mock", undefined, ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() enforces capability checks before executing the tool (input empty object)", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(mockTool);

    // Create a capability manager that denies fs.read
    const restrictedManager = new CapabilityManager({});
    const ctx = makeCtx(tmpDir, restrictedManager);

    expect(
      registry.run("mock", {}, ctx),
    ).rejects.toThrow("Capability denied");
  });

  test("run() passes the path from input to capability check", async () => {
    const registry = new MemoryToolRegistry();
    registry.register(mockTool);

    // Allow reads only under a specific directory
    const allowedDir = path.join(tmpDir, "allowed");
    await mkdir(allowedDir, { recursive: true });
    const allowedFile = path.join(allowedDir, "ok.txt");

    const scopedManager = new CapabilityManager({
      "fs.read": [`${allowedDir}/**`],
      "fs.write": [`${allowedDir}/**`],
    });

    const ctx = makeCtx(tmpDir, scopedManager);

    // Allowed path should work
    const result = await registry.run<{ ok: boolean; output: string }>("mock", { path: allowedFile }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toBe("mock output");

    // Disallowed path should fail
    const forbiddenFile = path.join(tmpDir, "forbidden.txt");

    expect(
      registry.run("mock", { path: forbiddenFile }, ctx),
    ).rejects.toThrow("Capability denied");
  });
});
