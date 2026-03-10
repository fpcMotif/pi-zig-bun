import { describe, expect, test } from "bun:test";
import { MemoryToolRegistry, type Tool } from "../../src/tools/types";

describe("MemoryToolRegistry", () => {
  test("TC-TOOLS-001 enforces capabilities and executes tool", async () => {
    const registry = new MemoryToolRegistry();
    const calls: string[] = [];

    const tool: Tool = {
      id: "sample",
      name: "sample",
      description: "sample tool",
      capabilities: ["fs.read"],
      async execute() {
        return { ok: true };
      },
    };

    registry.register(tool);

    const result = await registry.run<{ ok: boolean }>("sample", { path: "a.ts" }, {
      id: "x",
      cwd: process.cwd(),
      capabilities: {
        require(capability, target) {
          calls.push(`${capability}:${target}`);
        },
      },
    });

    expect(result.ok).toBeTrue();
    expect(calls).toEqual(["fs.read:a.ts"]);
  });

  test("TC-TOOLS-002 throws for missing tool", async () => {
    const registry = new MemoryToolRegistry();
    await expect(registry.run("missing", {}, {
      id: "x",
      cwd: process.cwd(),
      capabilities: { require() {} },
    })).rejects.toThrow("Tool not found");
  });
});
